const supabase = require('../config/supabase');

/**
 * NOTE on scope vs. the original design: the new ERD (master_roster_erd.html)
 * does not include ShiftTemplate or EmployeeAvailability tables, and Employee
 * has no employmentType field. So this generator is simplified accordingly:
 *   - Shift windows are fixed constants (Morning/Afternoon/Closing) rather
 *     than per-store configurable templates.
 *   - There's no availability filter — every active employee is eligible for
 *     every shift.
 *   - There's no full-time/part-time priority — assignment is purely by
 *     "fewest hours assigned so far this week" (fair distribution).
 * If you want template/availability support back, those tables can be added
 * to the schema later without breaking this service's shape.
 */

const FIXED_SHIFTS = [
  { name: 'Morning', startTime: '08:00', endTime: '16:00', breakMinutes: 60 },
  { name: 'Afternoon', startTime: '12:00', endTime: '20:00', breakMinutes: 60 },
  { name: 'Closing', startTime: '16:00', endTime: '24:00', breakMinutes: 60 },
];

function hoursBetween(start, end, breakMinutes = 0) {
  const [sh, sm] = start.split(':').map(Number);
  const eh = end === '24:00' ? 24 : Number(end.split(':')[0]);
  const em = end === '24:00' ? 0 : Number(end.split(':')[1]);
  const minutes = eh * 60 + em - (sh * 60 + sm) - breakMinutes;
  return Math.max(minutes / 60, 0);
}

const MAX_WEEKLY_HOURS = 48;

/**
 * Generates a weekly Roster + Shift rows for a store, staying within the
 * labor-hour budget derived from the store's LaborGuideline.targetProductivity
 * (sales THB per labor hour) and the forecasted sales for the week.
 */
async function generateRoster({ storeId, weekStart, forecastedSales, allowedHoursOverride, approvedBy }) {
  const { data: guideline, error: guidelineError } = await supabase
    .from('labor_guideline')
    .select('*')
    .eq('store_id', storeId)
    .limit(1)
    .maybeSingle(); // assumes one active guideline per store
  if (guidelineError) throw guidelineError;

  const { data: employees, error: employeesError } = await supabase
    .from('employee')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (employeesError) throw employeesError;
  if (employees.length === 0) {
    throw Object.assign(new Error('No active employees found for this store'), { status: 400 });
  }

  const targetProductivity = guideline?.target_productivity ? Number(guideline.target_productivity) : null;
  const allowedHours =
    allowedHoursOverride ?? (targetProductivity && forecastedSales ? Math.round(forecastedSales / targetProductivity) : 0);

  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);

  const hoursAssigned = Object.fromEntries(employees.map((e) => [e.id, 0]));
  const assignedDay = {}; // `${employeeId}-${dateStr}` -> true (max one shift/day)

  let totalScheduledHours = 0;
  const shiftRows = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(start);
    date.setDate(date.getDate() + dayOffset);
    const dateStr = date.toISOString().slice(0, 10);

    for (const shift of FIXED_SHIFTS) {
      if (allowedHours > 0 && totalScheduledHours >= allowedHours) break;

      const shiftHours = hoursBetween(shift.startTime, shift.endTime, shift.breakMinutes);

      const candidates = employees
        .filter((emp) => {
          const alreadyToday = assignedDay[`${emp.id}-${dateStr}`];
          const wouldExceedCap = hoursAssigned[emp.id] + shiftHours > MAX_WEEKLY_HOURS;
          return !alreadyToday && !wouldExceedCap;
        })
        .sort((a, b) => hoursAssigned[a.id] - hoursAssigned[b.id]); // fair distribution

      if (candidates.length === 0) continue;
      if (allowedHours > 0 && totalScheduledHours + shiftHours > allowedHours) continue;

      const chosen = candidates[0];

      shiftRows.push({
        employee_id: chosen.id,
        shift_date: dateStr,
        start_time: shift.startTime,
        end_time: shift.endTime,
        planned_hours: shiftHours,
      });

      hoursAssigned[chosen.id] += shiftHours;
      assignedDay[`${chosen.id}-${dateStr}`] = true;
      totalScheduledHours += shiftHours;
    }
  }

  const { data: rosterRow, error: rosterError } = await supabase
    .from('roster')
    .insert({
      store_id: storeId,
      week_start: start.toISOString().slice(0, 10),
      status: 'DRAFT',
      approved_by: approvedBy || null,
    })
    .select()
    .single();
  if (rosterError) throw rosterError;

  const { error: shiftsError } = await supabase
    .from('shift')
    .insert(shiftRows.map((row) => ({ ...row, roster_id: rosterRow.id })));
  if (shiftsError) throw shiftsError;

  const { data: roster, error: fetchError } = await supabase
    .from('roster')
    .select('*, shift(*, employee(*))')
    .eq('id', rosterRow.id)
    .single();
  if (fetchError) throw fetchError;

  return { ...roster, allowedHours, totalScheduledHours };
}

module.exports = { generateRoster, hoursBetween, FIXED_SHIFTS };
