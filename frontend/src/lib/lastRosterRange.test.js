import { describe, test, expect, beforeEach } from 'vitest';

/** Same in-memory localStorage stub the other lib tests use — vitest runs in node here. */
function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

const { isUsableRange, readLastGeneratedRange, rememberGeneratedRange } = await import('./lastRosterRange.js');

// A Thursday, so the current-week fallback is visibly different from the ranges under test.
const THURSDAY = '2026-09-10';
const CURRENT_WEEK = { startDate: '2026-09-07', endDate: '2026-09-13' };

describe('lastRosterRange', () => {
  test('opens on the current week when nothing was ever generated', () => {
    expect(readLastGeneratedRange(THURSDAY)).toEqual(CURRENT_WEEK);
  });

  test('a generated range is what the screen opens on next time', () => {
    rememberGeneratedRange({ startDate: '2026-10-01', endDate: '2026-10-14' });
    expect(readLastGeneratedRange(THURSDAY)).toEqual({ startDate: '2026-10-01', endDate: '2026-10-14' });
  });

  test('a later generate replaces the remembered range', () => {
    rememberGeneratedRange({ startDate: '2026-10-01', endDate: '2026-10-14' });
    rememberGeneratedRange({ startDate: '2026-11-02', endDate: '2026-11-08' });
    expect(readLastGeneratedRange(THURSDAY)).toEqual({ startDate: '2026-11-02', endDate: '2026-11-08' });
  });

  test('a single-day generate round-trips (start === end is a valid range)', () => {
    rememberGeneratedRange({ startDate: '2026-10-05', endDate: '2026-10-05' });
    expect(readLastGeneratedRange(THURSDAY)).toEqual({ startDate: '2026-10-05', endDate: '2026-10-05' });
  });

  test('an inverted range is never stored, so the screen still opens on the current week', () => {
    rememberGeneratedRange({ startDate: '2026-10-14', endDate: '2026-10-01' });
    expect(readLastGeneratedRange(THURSDAY)).toEqual(CURRENT_WEEK);
  });

  test('a partial range is never stored', () => {
    rememberGeneratedRange({ startDate: '2026-10-01', endDate: '' });
    rememberGeneratedRange({ startDate: undefined, endDate: '2026-10-14' });
    expect(readLastGeneratedRange(THURSDAY)).toEqual(CURRENT_WEEK);
  });

  test('a corrupt stored value falls back to the current week instead of throwing', () => {
    localStorage.setItem('master-roster:roster:last-generated-range', '{not json');
    expect(readLastGeneratedRange(THURSDAY)).toEqual(CURRENT_WEEK);
  });

  test('a stored value in a foreign shape falls back to the current week', () => {
    localStorage.setItem('master-roster:roster:last-generated-range', JSON.stringify({ week: '2026-W41' }));
    expect(readLastGeneratedRange(THURSDAY)).toEqual(CURRENT_WEEK);
  });

  test('a non-ISO date is rejected rather than fed to the date inputs', () => {
    expect(isUsableRange({ startDate: '01/10/2026', endDate: '14/10/2026' })).toBe(false);
    expect(isUsableRange({ startDate: '2026-10-01', endDate: '2026-10-14' })).toBe(true);
    expect(isUsableRange(null)).toBe(false);
  });
});
