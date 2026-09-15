import { getEmploymentType } from '../config/employmentTypes';
import { getShift } from '../config/shifts';

import { STORE_COVERAGE } from '../config/storeRules';

/** The last operating hour, e.g. 21 for a 22:00 close — the hour the closing pair must cover. */
const CLOSING_HOUR = Number(STORE_COVERAGE.closingTime.slice(0, 2)) - 1;


export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

export const toClock = (minutes) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return `${h}:${m}`;
};

/**
 * Resolves a shift for one employee: start comes from the shift, length from
 * the contract. The break is placed mid-shift so no stretch of work runs longer
 * than the statutory limit.
 */
export const resolveShift = (shiftId, employmentTypeId) => {
  const shift = getShift(shiftId);
  if (!shift) return null;
  const type = getEmploymentType(employmentTypeId);

  const startMin = toMinutes(shift.start);
  const workMin = type.workHours * 60;
  const breakMin = type.breakHours * 60;
  const breakStartMin = startMin + Math.floor(workMin / 2);

  return {
    shiftId: shift.id,
    label: shift.label,
    tone: shift.tone,
    from: shift.start,
    to: toClock(startMin + workMin + breakMin),
    breakFrom: toClock(breakStartMin),
    breakTo: toClock(breakStartMin + breakMin),
    workHours: type.workHours,
    breakHours: type.breakHours,
    startMin,
    endMin: startMin + workMin + breakMin
  };
};

/**
 * Paid hours for one assigned cell.
 *
 * Uses the shift's REAL planned_hours whenever the cell came from the backend. The contract
 * length (FT 8h / PT 6h) is only a fallback for cells that have no real shift behind them — the
 * generator sizes shifts to demand, so a Part-timer's day is routinely 4 or 5 hours, and counting
 * every one of them as a flat 6 made the Schedule Generation total disagree with the grid's own
 * per-day totals.
 */
export const cellWorkHours = (cell, employmentTypeId) => {
  if (cell?.plannedHours != null) return Number(cell.plannedHours);
  return resolveShift(cell?.shiftId, employmentTypeId)?.workHours ?? 0;
};

export const staffWeeklyHours = (member, days) =>
  days.reduce((sum, day) => sum + cellWorkHours(member.shifts[day], member.employmentType), 0);

export const totalScheduledHours = (staff, days) =>
  staff.reduce((sum, member) => sum + staffWeeklyHours(member, days), 0);

/**
 * Is this employee on the floor at this clock hour? Counted the way the backend counts it: inside
 * the shift, and not during the unpaid break.
 */
const onFloorAt = (member, day, hour) => {
  const cell = member.shifts[day];
  if (!cell?.startTime || !cell?.endTime) return false;
  const start = Number(cell.startTime.slice(0, 2));
  const end = Number(cell.endTime.slice(0, 2));
  const breakStart = cell.breakStartTime ? Number(cell.breakStartTime.slice(0, 2)) : null;
  return hour >= start && hour < end && hour !== breakStart;
};

export const scheduledFor = (staff, day, hour) => staff.filter((m) => onFloorAt(m, day, hour)).length;

/**
 * Grid colour for one hour, three states:
 *   - understaffed (red)    fewer people on the floor than the hour's minimum — the same test the
 *                           backend uses, so red always means a real shortage;
 *   - overstaffed (yellow)  more people than that hour's sales can justify;
 *   - matched (green)       anything in between.
 *
 * `required` is the minimum INCLUDING the closing pair on the last operating hour (see
 * buildDemandRows), and the justified figure is never allowed below it. Otherwise the two closers
 * the store must have would be painted yellow every night while the forecast justifies only one;
 * a third body there is still yellow.
 *
 * Red used to be measured against the justified figure, so "2 on the floor where sales justify 3
 * and the minimum is 1" was shown as a shortage. Being below what sales could support is room to
 * add, not a shortfall.
 */
export const statusOf = (required, justified, scheduled) => {
  if (scheduled < required) return 'understaffed';
  if (scheduled > Math.max(justified, required)) return 'overstaffed';
  return 'matched';
};

/**
 * One row per operating hour, comparing the backend's own demand figure against what is actually
 * scheduled. `demandDays` comes straight from GET /labor/demand (laborDemandService) — this
 * function picks no headcount of its own.
 */
export const buildDemandRows = (staff, days, demandDays = []) => {
  const demandByDayHour = new Map();
  const requiredByDayHour = new Map();
  const hours = new Set();
  for (const day of demandDays) {
    for (const h of day.hours ?? []) {
      demandByDayHour.set(`${day.date}|${h.hour}`, h.maxJustifiedHeadcount ?? h.requiredHeadcount ?? 0);
      requiredByDayHour.set(`${day.date}|${h.hour}`, h.requiredHeadcount ?? 1);
      hours.add(h.hour);
    }
  }

  return [...hours].sort((a, b) => a - b).map((hour) => ({
    id: `h${hour}`,
    label: `${String(hour).padStart(2, '0')}:00`,
    caption: '',
    cells: days.map((day) => {
      const demand = demandByDayHour.get(`${day}|${hour}`) ?? 0;
      // The last operating hour must carry the closing pair whatever the forecast says.
      const baseRequired = requiredByDayHour.get(`${day}|${hour}`) ?? 1;
      const required = hour === CLOSING_HOUR ? Math.max(baseRequired, STORE_COVERAGE.minClosers) : baseRequired;
      const scheduled = scheduledFor(staff, day, hour);
      return { day, demand, required, scheduled, status: statusOf(required, demand, scheduled) };
    }),
  }));
};
