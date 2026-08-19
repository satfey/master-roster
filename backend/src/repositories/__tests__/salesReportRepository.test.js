// Mocks only the Supabase client (not the repository itself) so the real
// batching logic in salesReportRepository.js runs end-to-end against a fake
// in-memory table, proving large `.in(...)` lookups are actually chunked.
let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const repo = require('../salesReportRepository');

/** Minimal fake supabase-js query builder: supports .select().in().gte().lte() and is awaitable. */
function createFakeFrom(tables) {
  const inCalls = [];
  const from = jest.fn((tableName) => {
    const rows = tables[tableName] || [];
    const state = { column: null, values: null, filters: [] };
    const builder = {
      select: jest.fn(() => builder),
      in: jest.fn((column, values) => {
        state.column = column;
        state.values = values;
        inCalls.push({ table: tableName, column, values: [...values] });
        return builder;
      }),
      gte: jest.fn((col, val) => { state.filters.push(['gte', col, val]); return builder; }),
      lte: jest.fn((col, val) => { state.filters.push(['lte', col, val]); return builder; }),
      then(resolve, reject) {
        let matched = rows.filter((r) => state.values.includes(r[state.column]));
        for (const [op, col, val] of state.filters) {
          matched = matched.filter((r) => (op === 'gte' ? r[col] >= val : r[col] <= val));
        }
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  return { from, inCalls };
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('salesReportRepository — batched .in() lookups (UND_ERR_HEADERS_OVERFLOW regression)', () => {
  test('findStoresByCodes batches a 250-code lookup into requests of <=100 each, with no duplicates or losses', async () => {
    const storeCodes = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const storeTable = storeCodes.map((code, i) => ({ id: `store-${i}`, storeCode: code, name: `Store ${code}` }));
    const { from, inCalls } = createFakeFrom({ store: storeTable });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes(storeCodes);

    // Batched into multiple requests, each within a safe size.
    expect(inCalls.length).toBeGreaterThan(1);
    for (const call of inCalls) {
      expect(call.values.length).toBeLessThanOrEqual(100);
      // A single batch's filter value would never approach the ~16KB URL limit.
      expect(call.values.join(',').length).toBeLessThan(5000);
    }
    // Every code across every batch, concatenated, reconstructs the original list exactly once each.
    expect(inCalls.flatMap((c) => c.values)).toEqual(storeCodes);

    // Results are correct and complete — nothing lost or duplicated by batching.
    expect(result.size).toBe(250);
    for (const code of storeCodes) expect(result.get(code)).toMatchObject({ storeCode: code });
  });

  test('findExistingReportKeys batches a 200-store-id lookup and still applies the date range filter correctly per batch', async () => {
    const storeIds = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const inRangeRows = storeIds.map((id) => ({ store_id: id, report_date: '2026-07-15' }));
    const outOfRangeRows = storeIds.slice(0, 5).map((id) => ({ store_id: id, report_date: '2020-01-01' })); // must be excluded by the date filter
    const { from, inCalls } = createFakeFrom({ sales_report: [...inRangeRows, ...outOfRangeRows] });
    mockFromImpl = from;

    const dates = [new Date(Date.UTC(2026, 6, 1)), new Date(Date.UTC(2026, 6, 31))];
    const keys = await repo.findExistingReportKeys(storeIds, dates);

    expect(inCalls.length).toBeGreaterThan(1);
    for (const call of inCalls) expect(call.values.length).toBeLessThanOrEqual(100);

    // 200 in-range rows found, none of the out-of-range ones leaked in.
    expect(keys.size).toBe(200);
    expect(keys.has(repo.recordKey(storeIds[0], '2026-07-15'))).toBe(true);
    expect(keys.has(repo.recordKey(storeIds[0], '2020-01-01'))).toBe(false);
  });

  test('an empty id list never issues a request (existing short-circuit is preserved)', async () => {
    const { from } = createFakeFrom({ store: [] });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes([]);

    expect(from).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});
