export function trimOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/,/g, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

/** Handles both "5%" text and already-decimal numbers (xlsx returns percent-formatted cells as 0.05, not "5%"). */
export function toPercentDecimal(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (str === '') return null;
  if (str.endsWith('%')) {
    const num = Number(str.slice(0, -1).trim());
    return Number.isNaN(num) ? null : num / 100;
  }
  const num = Number(str);
  return Number.isNaN(num) ? null : num;
}

// Excel's day-0 epoch is 1899-12-30; 25569 is the number of days between
// that epoch and the Unix epoch (1970-01-01) — the same constant already
// used by frontend/src/lib/calc.js's excelDateToStr, kept in sync here.
// exceljs hands back a native Date for genuinely date-formatted cells (see
// excel.ts's resolveCellValue), so this only runs for a plain number cell
// that isn't styled as a date but is still meant to be read as one.
function excelSerialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

export function excelDateToISO(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    date = excelSerialToDate(value);
  } else {
    const str = String(value).trim();
    if (str === '') return null;
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
