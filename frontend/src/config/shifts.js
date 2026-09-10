/**
 * A shift defines only when the employee starts. The finish time comes from
 * their employment type, so one shift covers every contract length.
 */
export const SHIFTS = {
  MORNING: { id: 'MORNING', label: 'เช้า', short: 'ช', start: '09:00', tone: 'green' },
  AFTERNOON: { id: 'AFTERNOON', label: 'บ่าย', short: 'บ', start: '11:00', tone: 'pink' },
  EVENING: { id: 'EVENING', label: 'เย็น', short: 'ย', start: '13:00', tone: 'blue' }
};

export const SHIFT_LIST = Object.values(SHIFTS);

/** Order used by the one-click cycle: เช้า -> บ่าย -> เย็น -> หยุด -> เช้า */
export const SHIFT_CYCLE = ['MORNING', 'AFTERNOON', 'EVENING', null];

export const getShift = (shiftId) => (shiftId ? SHIFTS[shiftId] ?? null : null);

export const nextShiftId = (currentId) => {
  const index = SHIFT_CYCLE.indexOf(currentId ?? null);
  return SHIFT_CYCLE[(index + 1) % SHIFT_CYCLE.length];
};
