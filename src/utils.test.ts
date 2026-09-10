import { describe, test, expect } from 'vitest';
import { excelDateToISO, toNumberOrNull, toPercentDecimal, trimOrNull } from './utils';

describe('excelDateToISO (no longer depends on xlsx\'s SSF module)', () => {
  test('a native Date (what exceljs returns for date-formatted cells) converts directly', () => {
    expect(excelDateToISO(new Date(Date.UTC(2026, 6, 9)))).toBe('2026-07-09');
  });

  test('a raw Excel serial number (an un-formatted numeric cell meant to be a date) converts via the manual epoch calculation', () => {
    // 46212 = 2026-07-09 in Excel's day-count (1899-12-30 epoch).
    expect(excelDateToISO(46212)).toBe('2026-07-09');
  });

  test('a date-like string still parses via the Date constructor fallback', () => {
    expect(excelDateToISO('2026-07-09')).toBe('2026-07-09');
  });

  test('null, undefined, and empty string all map to null', () => {
    expect(excelDateToISO(null)).toBeNull();
    expect(excelDateToISO(undefined)).toBeNull();
    expect(excelDateToISO('')).toBeNull();
  });

  test('an unparseable string maps to null rather than throwing', () => {
    expect(excelDateToISO('not a date')).toBeNull();
  });
});

describe('toNumberOrNull / toPercentDecimal / trimOrNull (unaffected by the xlsx -> exceljs swap)', () => {
  test('toNumberOrNull handles numbers, comma-formatted strings, and blanks', () => {
    expect(toNumberOrNull(42)).toBe(42);
    expect(toNumberOrNull('1,234.5')).toBe(1234.5);
    expect(toNumberOrNull('')).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
  });

  test('toPercentDecimal handles "5%" text and already-decimal numbers', () => {
    expect(toPercentDecimal('5%')).toBe(0.05);
    expect(toPercentDecimal(0.05)).toBe(0.05);
    expect(toPercentDecimal(null)).toBeNull();
  });

  test('trimOrNull trims and collapses blank strings to null', () => {
    expect(trimOrNull('  hello  ')).toBe('hello');
    expect(trimOrNull('   ')).toBeNull();
    expect(trimOrNull(null)).toBeNull();
  });
});
