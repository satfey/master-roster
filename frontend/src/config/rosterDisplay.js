/**
 * Display labels and legends for the roster screens.
 *
 * These are presentation constants, not data — they name and colour states the
 * backend already decides. They used to live in src/mock/, which made them look
 * like sample data; nothing in the app reads a number from here.
 */

/** Legend for the Headcount Demand vs Schedule grid. */
export const ROSTER_STATUS_LEGEND = [
  { id: 'understaffed', label: 'Understaffed', tone: 'red' },
  { id: 'matched', label: 'Matched', tone: 'green' },
  { id: 'overstaffed', label: 'Overstaffed', tone: 'amber' }
];

/** Legend of the all-store Exception Heatmap (Admin / Area Coach view). */
export const EXCEPTION_STATUS_LEGEND = [
  { id: 'understaffed', label: 'Understaffed Pin', tone: 'red' },
  { id: 'matched', label: 'Matched', tone: 'green' },
  { id: 'overstaffed', label: 'Overstaffed Pin', tone: 'amber' }
];

/** Thai weekday names, keyed both by short code and by JS getUTCDay() index. */
export const DAY_LABELS = {
  MON: 'วันจันทร์',
  TUE: 'วันอังคาร',
  WED: 'วันพุธ',
  THU: 'วันพฤหัสบดี',
  FRI: 'วันศุกร์',
  SAT: 'วันเสาร์',
  SUN: 'วันอาทิตย์'
};

const WEEKDAY_BY_INDEX = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Thai weekday name for an ISO date ('2026-09-07' -> 'วันจันทร์'). */
export const dayLabelForDate = (isoDate) => {
  const index = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return DAY_LABELS[WEEKDAY_BY_INDEX[index]] ?? isoDate;
};
