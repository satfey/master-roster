import { LABOR_LAW, getEmploymentType } from '../config/employmentTypes';
import { resolveShift, staffWeeklyHours, toMinutes } from './rosterUtils';

/**
 * Checks one employee's week against their contract and the statutory limits.
 * Returns [] when the schedule is compliant.
 */
export const validateStaffMember = (member, days) => {
  const type = getEmploymentType(member.employmentType);
  const violations = [];

  // 1. Daily ceiling for the contract type
  days.forEach((day) => {
    const resolved = resolveShift(member.shifts[day]?.shiftId, member.employmentType);
    if (resolved && resolved.workHours > type.maxDailyWorkHours) {
      violations.push({
        code: 'DAILY_LIMIT',
        day,
        severity: 'error',
        message: `${day}: ทำงาน ${resolved.workHours} ชม. เกินเพดาน ${type.maxDailyWorkHours} ชม. ของ${type.label}`
      });
    }
  });

  // 2. Weekly ceiling — the contract's own limit and the statutory 48 hours
  const weekly = staffWeeklyHours(member, days);
  const weeklyCap = Math.min(type.maxWeeklyWorkHours, LABOR_LAW.maxWeeklyWorkHours);
  if (weekly > weeklyCap) {
    violations.push({
      code: 'WEEKLY_LIMIT',
      severity: 'error',
      message: `รวม ${weekly} ชม./สัปดาห์ เกินเพดาน ${weeklyCap} ชม.`
    });
  }

  // 3. One day off per week
  const workedDays = days.filter((day) => member.shifts[day]?.shiftId);
  if (workedDays.length > LABOR_LAW.maxConsecutiveWorkDays) {
    violations.push({
      code: 'NO_DAY_OFF',
      severity: 'error',
      message: `ทำงาน ${workedDays.length} วันติด ต้องมีวันหยุดอย่างน้อย 1 วันต่อสัปดาห์`
    });
  }

  // 4. Rest between consecutive shifts
  days.forEach((day, index) => {
    if (index === 0) return;
    const prev = resolveShift(member.shifts[days[index - 1]]?.shiftId, member.employmentType);
    const current = resolveShift(member.shifts[day]?.shiftId, member.employmentType);
    if (!prev || !current) return;
    const restHours = (current.startMin + 1440 - prev.endMin) / 60;
    if (restHours < LABOR_LAW.minHoursBetweenShifts) {
      violations.push({
        code: 'SHORT_REST',
        day,
        severity: 'warning',
        message: `${day}: พักระหว่างกะเพียง ${restHours.toFixed(1)} ชม. ควรมีอย่างน้อย ${LABOR_LAW.minHoursBetweenShifts} ชม.`
      });
    }
  });

  // 5. Night work for under-18 dual vocational students
  if (!type.nightWorkAllowed && type.nightWorkStart) {
    const limit = toMinutes(type.nightWorkStart);
    days.forEach((day) => {
      const resolved = resolveShift(member.shifts[day]?.shiftId, member.employmentType);
      if (resolved && resolved.endMin > limit) {
        violations.push({
          code: 'NIGHT_WORK',
          day,
          severity: 'error',
          message: `${day}: เลิกงาน ${resolved.to} ${type.label}ทำงานหลัง ${type.nightWorkStart} ไม่ได้`
        });
      }
    });
  }

  return violations;
};

/** Every violation across the roster, grouped by employee. */
export const validateRoster = (staff, days) =>
  staff
    .map((member) => ({
      staffId: member.id,
      name: member.name,
      violations: validateStaffMember(member, days)
    }))
    .filter((entry) => entry.violations.length > 0);

/** Days that carry at least one violation, for highlighting cells. */
export const violationDaysFor = (member, days) =>
  new Set(validateStaffMember(member, days).filter((v) => v.day).map((v) => v.day));
