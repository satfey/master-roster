// Mocks only the Supabase client (not the repository itself) so the real
// batching logic in salesByHourRepository.js runs end-to-end against a fake
// in-memory table, proving large `.in(...)` lookups are actually chunked.
let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const repo = require('../salesByHourRepository');

/** Minimal fake supabase-js query builder: supports .select().in().eq() and is awaitable. */
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
      eq: jest.fn((col, val) => { state.filters.push([col, val]); return builder; }),
      then(resolve, reject) {
        let matched = rows.filter((r) => state.values.includes(r[state.column]));
        for (const [col, val] of state.filters) matched = matched.filter((r) => r[col] === val);
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  return { from, inCalls };
}

beforeEach(() => {
  mockFromImpl = undefined;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

describe('salesByHourRepository — batched .in() lookups (UND_ERR_HEADERS_OVERFLOW regression)', () => {
  test('findStoresByCodes batches a 250-code lookup into requests of <=100 each, with no duplicates or losses', async () => {
    const storeCodes = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const storeTable = storeCodes.map((code, i) => ({ id: `store-${i}`, storeCode: code, name: `Store ${code}` }));
    const { from, inCalls } = createFakeFrom({ store: storeTable });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes(storeCodes);

    expect(inCalls.length).toBeGreaterThan(1);
    for (const call of inCalls) {
      expect(call.values.length).toBeLessThanOrEqual(100);
      expect(call.values.join(',').length).toBeLessThan(5000); // never approaches the ~16KB URL limit
    }
    expect(inCalls.flatMap((c) => c.values)).toEqual(storeCodes);

    expect(result.size).toBe(250);
    for (const code of storeCodes) expect(result.get(code)).toMatchObject({ storeCode: code });
  });

  test('findExistingRecordKeys batches a 200-store-id lookup (the exact shape of the UND_ERR_HEADERS_OVERFLOW report) and still applies the month filter correctly per batch', async () => {
    const storeIds = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const inMonthRows = storeIds.map((id) => ({ store_id: id, report_month: '2026-07-01', hour: 9 }));
    const otherMonthRows = storeIds.slice(0, 5).map((id) => ({ store_id: id, report_month: '2020-01-01', hour: 9 })); // must be excluded
    const { from, inCalls } = createFakeFrom({ sales_by_hour: [...inMonthRows, ...otherMonthRows] });
    mockFromImpl = from;

    const keys = await repo.findExistingRecordKeys(storeIds, '2026-07-01');

    expect(inCalls.length).toBeGreaterThan(1);
    for (const call of inCalls) expect(call.values.length).toBeLessThanOrEqual(100);

    expect(keys.size).toBe(200);
    expect(keys.has(repo.recordKey(storeIds[0], '2026-07-01', 9))).toBe(true);
    expect(keys.has(repo.recordKey(storeIds[0], '2020-01-01', 9))).toBe(false);
  });

  test('an empty id list never issues a request (existing short-circuit is preserved)', async () => {
    const { from } = createFakeFrom({ store: [] });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes([]);

    expect(from).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  test('diagnostic logging reports the filter count and batch size, without ever logging auth headers/credentials', async () => {
    const storeIds = Array.from({ length: 150 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const { from } = createFakeFrom({ sales_by_hour: [] });
    mockFromImpl = from;

    await repo.findExistingRecordKeys(storeIds, '2026-07-01');

    const logged = console.log.mock.calls.map((args) => JSON.stringify(args));
    expect(logged.some((l) => l.includes('"filterCount":150'))).toBe(true);
    expect(logged.some((l) => l.includes('"batchSize":100'))).toBe(true);
    expect(logged.join('\n')).not.toMatch(/authorization|apikey|bearer/i);
  });
});
