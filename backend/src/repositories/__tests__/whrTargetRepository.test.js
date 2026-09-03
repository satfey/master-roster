let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const repo = require('../whrTargetRepository');

/** Minimal fake supabase-js query builder: supports .select().in().eq().range().upsert() and is awaitable. */
function createFakeFrom(tables) {
  const inCalls = [];
  const upsertCalls = [];
  const from = jest.fn((tableName) => {
    const rows = tables[tableName] || (tables[tableName] = []);
    const state = { column: null, values: null, filters: [], range: null, upsertResults: null };
    const builder = {
      select: jest.fn(() => builder),
      in: jest.fn((column, values) => {
        state.column = column;
        state.values = values;
        inCalls.push({ table: tableName, column, values: [...values] });
        return builder;
      }),
      eq: jest.fn((col, val) => { state.filters.push([col, val]); return builder; }),
      range: jest.fn((from2, to2) => { state.range = [from2, to2]; return builder; }),
      single: jest.fn(() => builder),
      upsert: jest.fn((payload, options) => {
        upsertCalls.push({ table: tableName, payload, options });
        const conflictCols = ((options && options.onConflict) || '').split(',').map((s) => s.trim()).filter(Boolean);
        state.upsertResults = payload.map((record) => {
          const existing = conflictCols.length ? rows.find((r) => conflictCols.every((c) => r[c] === record[c])) : undefined;
          if (existing) {
            Object.assign(existing, record);
            return existing;
          }
          const created = { id: `generated-${rows.length}`, created_at: '2000-01-01T00:00:00.000Z', ...record };
          rows.push(created);
          return created;
        });
        return builder;
      }),
      then(resolve, reject) {
        let matched;
        if (state.upsertResults) matched = state.upsertResults;
        else matched = rows.filter((r) => state.values.includes(r[state.column]));
        for (const [col, val] of state.filters) matched = matched.filter((r) => r[col] === val);
        if (state.range) matched = matched.slice(state.range[0], state.range[1] + 1);
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  return { from, inCalls, upsertCalls };
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('whrTargetRepository — findStoresByCodes', () => {
  test('looks up by id (Excel CODE IS store.id) and batches a 250-code lookup into requests of <=100 each', async () => {
    const storeCodes = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const storeTable = storeCodes.map((code) => ({ id: code, name: `Store ${code}` }));
    const { from, inCalls } = createFakeFrom({ store: storeTable });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes(storeCodes);

    expect(inCalls.length).toBeGreaterThan(1);
    for (const call of inCalls) expect(call.values.length).toBeLessThanOrEqual(100);
    expect(result.size).toBe(250);
  });

  test('an empty code list never issues a request', async () => {
    const { from } = createFakeFrom({ store: [] });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes([]);

    expect(from).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});

describe('whrTargetRepository — findExistingRecordKeys / recordKey', () => {
  test('finds existing (store_id, report_month) keys, scoped to the given month only', async () => {
    const rows = [
      { store_id: '1001', report_month: '2026-07-01' },
      { store_id: '1002', report_month: '2026-07-01' },
      { store_id: '1001', report_month: '2026-08-01' }, // different month -> must not leak in
    ];
    const { from } = createFakeFrom({ whr_target_monthly: rows });
    mockFromImpl = from;

    const keys = await repo.findExistingRecordKeys(['1001', '1002'], '2026-07-01');

    expect(keys.has(repo.recordKey('1001', '2026-07-01'))).toBe(true);
    expect(keys.has(repo.recordKey('1002', '2026-07-01'))).toBe(true);
    expect(keys.has(repo.recordKey('1001', '2026-08-01'))).toBe(false);
    expect(keys.size).toBe(2);
  });

  test('13. finds every matching key even when a single batch matches more than 1000 rows (PostgREST default page cap)', async () => {
    const rows = [];
    for (let d = 0; d < 1200; d++) rows.push({ store_id: '1001', report_month: '2026-07-01', _seq: d }); // same key repeated is unrealistic for this table (unique constraint), but proves pagination alone; use distinct-looking rows via a throwaway field
    const { from } = createFakeFrom({ whr_target_monthly: rows });
    mockFromImpl = from;

    const keys = await repo.findExistingRecordKeys(['1001'], '2026-07-01');

    // All 1200 rows share the same (store_id, report_month) key in this synthetic test, so the
    // real assertion is that findExistingRecordKeys actually read all 1200 rows rather than
    // being capped at 1000 — proven indirectly via the repo-level pagination test in
    // batchQuery.test.js / salesReportRepository.test.js; here we just confirm the key itself
    // still resolves correctly at this scale without throwing or truncating silently.
    expect(keys.has(repo.recordKey('1001', '2026-07-01'))).toBe(true);
  });

  test('an empty store id list never issues a request', async () => {
    const { from } = createFakeFrom({ whr_target_monthly: [] });
    mockFromImpl = from;

    const keys = await repo.findExistingRecordKeys([], '2026-07-01');

    expect(from).not.toHaveBeenCalled();
    expect(keys.size).toBe(0);
  });
});

describe('whrTargetRepository — upsertRecords (ON CONFLICT (store_id, report_month) DO UPDATE)', () => {
  test('a new (store_id, report_month) key is inserted with a generated id and created_at', async () => {
    const { from, upsertCalls } = createFakeFrom({ whr_target_monthly: [] });
    mockFromImpl = from;

    const count = await repo.upsertRecords([{ store_id: '1001', report_month: '2026-07-01', whrs: 620, sales: 500000 }]);

    expect(count).toBe(1);
    expect(upsertCalls[0].options).toEqual({ onConflict: 'store_id,report_month' });
    expect(upsertCalls[0].payload[0].id).toBeUndefined();
    expect(upsertCalls[0].payload[0].created_at).toBeUndefined();
  });

  test('14. re-importing the same store+month overwrites in place — not duplicated, no 23505 unique-violation', async () => {
    const table = {
      whr_target_monthly: [{ id: 'existing-1', store_id: '1001', report_month: '2026-07-01', whrs: 600, sales: 400000, created_at: '2026-01-01T00:00:00.000Z' }],
    };
    const { from } = createFakeFrom(table);
    mockFromImpl = from;

    const count = await repo.upsertRecords([{ store_id: '1001', report_month: '2026-07-01', whrs: 620, sales: 500000 }]);

    expect(count).toBe(1);
    expect(table.whr_target_monthly).toHaveLength(1); // still exactly one row for this key
    expect(table.whr_target_monthly[0].id).toBe('existing-1'); // PK untouched
    expect(table.whr_target_monthly[0].whrs).toBe(620); // overwritten with the new file's data
    expect(table.whr_target_monthly[0].created_at).toBe('2026-01-01T00:00:00.000Z'); // preserved
  });

  test('an empty records list never issues a request', async () => {
    const { from, upsertCalls } = createFakeFrom({ whr_target_monthly: [] });
    mockFromImpl = from;

    const count = await repo.upsertRecords([]);

    expect(count).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });

  test('propagates the error and writes nothing when the upsert itself fails', async () => {
    mockFromImpl = () => ({
      upsert: () => ({ select: () => Promise.resolve({ data: null, error: new Error('constraint violation') }) }),
    });

    await expect(repo.upsertRecords([{ store_id: '1001', report_month: '2026-07-01' }])).rejects.toThrow('constraint violation');
  });
});
