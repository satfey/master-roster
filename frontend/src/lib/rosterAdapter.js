// Translates the backend's real roster data into the shape the roster screen
// renders, and nothing more. The backend is the source of truth for every
// number here — this file only reshapes, it never decides staffing.
//
// Backend model                          Roster screen model
// ------------------------------------   ---------------------------------
// shift { shift_date, start_time, ... }   staff[].shifts[day] = { shiftId }
// employee { position_time_type, ... }    staff[] = { id, name, employmentType }
// sales_forecast per date                 dailySales[day]
//
// The screen keys everything off `days`, so real ISO dates are used as the day
// keys instead of the MON/TUE labels the mock shipped with. That keeps a roster
// spanning any date range renderable, not just a fixed four-day week.

import { SHIFTS } from '../config/shifts.js';

/** Every ISO date from start to end inclusive. */
export function eachDate(startDate, endDate) {
  const days = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** The Monday-to-Sunday week containing `today` (an ISO date string). */
export function weekRange(today) {
  const date = new Date(`${today}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() + offsetToMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

/**
 * Buckets a real clock-in time into one of the screen's three shift columns by
 * whichever bucket start it is closest to. The backend places shifts at
 * whatever hour demand justifies, so an exact match cannot be assumed — an
 * 08:00 or 10:00 start still has to land somewhere sensible on the grid.
 */
export function shiftBucket(startTime) {
  if (!startTime) return null;
  const hour = Number(String(startTime).slice(0, 2));
  if (Number.isNaN(hour)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const shift of Object.values(SHIFTS)) {
    const distance = Math.abs(Number(shift.start.slice(0, 2)) - hour);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = shift.id;
    }
  }
  return best;
}

/**
 * The employment type the labour-rule checks run against. `position_time_type`
 * is free text as imported from HR ("Full time", "Part time"), so it is matched
 * loosely; anything unrecognised falls back to FULL_TIME, which is the stricter
 * of the two for weekly-hour purposes and therefore the safer default.
 */
export function employmentTypeOf(employee) {
  const raw = String(employee?.position_time_type || '').toLowerCase();
  if (raw.includes('part')) return 'PART_TIME';
  return 'FULL_TIME';
}

/** Thai name when HR provided one, otherwise the latin name, otherwise the id. */
export function staffNameOf(employee) {
  const local = [employee?.first_name_local, employee?.last_name_local].filter(Boolean).join(' ').trim();
  if (local) return local;
  const latin = [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim();
  return latin || String(employee?.id ?? '');
}

/**
 * Builds the roster view model. Every employee of the store gets a row, whether
 * or not the generator gave them shifts — a day with no shift renders as a day
 * off, which is exactly what it is.
 */
export function buildRosterView({ storeId, employees = [], shifts = [], days = [], dailySales = {}, quota = 0, demandDays = [] }) {
  const byEmployee = new Map();
  for (const shift of shifts) {
    if (!byEmployee.has(shift.employee_id)) byEmployee.set(shift.employee_id, new Map());
    byEmployee.get(shift.employee_id).set(shift.shift_date, shift);
  }

  const staff = employees.map((employee, index) => {
    const own = byEmployee.get(employee.id);
    const cells = {};
    for (const day of days) {
      const shift = own?.get(day);
      cells[day] = shift
        ? {
            shiftId: shiftBucket(shift.start_time),
            // The real shift row, carried so a cell can be reassigned to
            // another employee and can show the hours the generator set.
            rosterShiftId: shift.id ?? null,
            // Guarded: String(undefined).slice(0,5) would render the literal
            // text "undef" in the cell editor rather than showing nothing.
            startTime: shift.start_time ? String(shift.start_time).slice(0, 5) : null,
            endTime: shift.end_time ? String(shift.end_time).slice(0, 5) : null,
            plannedHours: shift.planned_hours ?? null,
            // Needed to count floor coverage the way the backend does: an employee on
            // their unpaid break is not staffing that hour.
            breakStartTime: shift.break_start_time ? String(shift.break_start_time).slice(0, 5) : null,
          }
        : { shiftId: null };
    }
    return {
      id: employee.id,
      name: staffNameOf(employee),
      // Shown on the grid in place of the name — who covers a shift is decided
      // by the manager in the cell editor, not published on the schedule.
      position: employee.position || 'Staff',
      positionLabel: `${employee.position || 'Staff'} ${index + 1}`,
      employmentType: employmentTypeOf(employee),
      shifts: cells,
    };
  });

  return {
    storeId,
    days,
    staff,
    demandDays,
    quota,
    dailySales: Object.fromEntries(days.map((day) => [day, dailySales[day] ?? 0])),
  };
}
