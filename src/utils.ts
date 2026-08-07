import * as XLSX from 'xlsx';

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

export function excelDateToISO(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  } else {
    const str = String(value).trim();
    if (str === '') return null;
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
