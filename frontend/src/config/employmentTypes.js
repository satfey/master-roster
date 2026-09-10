/**
 * Employment types. Shift length is derived from these, not fixed per shift:
 * a part-timer on the morning shift finishes earlier than a full-timer on the
 * same shift.
 *
 * workHours  = paid hours actually worked
 * breakHours = unpaid break sitting inside the shift window
 * span       = workHours + breakHours (clock-in to clock-out)
 */
export const EMPLOYMENT_TYPES = {
  FULL_TIME: {
    id: 'FULL_TIME',
    label: 'พนักงานประจำ',
    short: 'ประจำ',
    workHours: 8,
    breakHours: 1,
    maxDailyWorkHours: 8,
    maxWeeklyWorkHours: 48,
    nightWorkAllowed: true
  },
  PART_TIME: {
    id: 'PART_TIME',
    label: 'พาร์ทไทม์',
    short: 'พาร์ทไทม์',
    workHours: 6,
    breakHours: 1,
    maxDailyWorkHours: 6,
    maxWeeklyWorkHours: 36,
    nightWorkAllowed: true
  },
  DUAL_VOCATIONAL: {
    id: 'DUAL_VOCATIONAL',
    label: 'นักเรียนทวิภาคี',
    short: 'ทวิภาคี',
    workHours: 8,
    breakHours: 1,
    maxDailyWorkHours: 8,
    maxWeeklyWorkHours: 48,
    // Under-18 workers may not work late at night.
    nightWorkAllowed: false,
    nightWorkStart: '22:00'
  }
};

export const EMPLOYMENT_TYPE_LIST = Object.values(EMPLOYMENT_TYPES);

export const getEmploymentType = (id) => EMPLOYMENT_TYPES[id] ?? EMPLOYMENT_TYPES.FULL_TIME;

/** Statutory ceilings applied to everyone regardless of contract. */
export const LABOR_LAW = {
  maxWeeklyWorkHours: 48,
  maxConsecutiveWorkDays: 6,
  minHoursBetweenShifts: 10,
  maxHoursBeforeBreak: 5
};
