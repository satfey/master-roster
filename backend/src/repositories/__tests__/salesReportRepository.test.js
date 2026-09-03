// Mocks only the Supabase client (not the repository itself) so the real
// batching logic in salesReportRepository.js runs end-to-end against a fake
// in-memory table, proving large `.in(...)` lookups are actually chunked.
let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const repo = require('../salesReportRepository');

/**
 * Minimal fake supabase-js query builder: supports
 * .select().in().gte().lte().insert().upsert() and is awaitable.
 *
 * upsert() actually performs an ON CONFLICT (onConflict columns) DO UPDATE
 * merge against the in-memory `rows` array (mutating it in place for a
 * matching key, pushing a brand-new row otherwise) — real enough to prove
 * the repository's upsertRecords() overwrites an existing row rather than
 * duplicating it, and that fields absent from the payload (id, created_at)
 * are left untouched on an existing row.
 */
function createFakeFrom(tables) {
  const inCalls = [];
  const insertCalls = [];
  const upsertCalls = [];
  const from = jest.fn((tableName) => {
    const rows = tables[tableName] || (tables[tableName] = []);
    const state = { column: null, values: null, filters: [], insertPayload: null, upsertResults: null, range: null };
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
      range: jest.fn((from2, to2) => { state.range = [from2, to2]; return builder; }),
      insert: jest.fn((payload) => {
        state.insertPayload = payload;
        insertCalls.push({ table: tableName, payload });
        rows.push(...payload);
        return builder;
      }),
      upsert: jest.fn((payload, options) => {
        upsertCalls.push({ table: tableName, payload, options });
        const conflictCols = ((options && options.onConflict) || '').split(',').map((s) => s.trim()).filter(Boolean);
        state.upsertResults = payload.map((record) => {
          const existing = conflictCols.length ? rows.find((r) => conflictCols.every((c) => r[c] === record[c])) : undefined;
          if (existing) {
            Object.assign(existing, record); // only fields present in `record` change — id/created_at stay whatever they already were
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
        else if (state.insertPayload) matched = state.insertPayload;
        else matched = rows.filter((r) => state.values.includes(r[state.column]));
        for (const [op, col, val] of state.filters) {
          matched = matched.filter((r) => (op === 'gte' ? r[col] >= val : r[col] <= val));
        }
        if (state.range) matched = matched.slice(state.range[0], state.range[1] + 1);
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  return { from, inCalls, insertCalls, upsertCalls };
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('salesReportRepository — batched .in() lookups (UND_ERR_HEADERS_OVERFLOW regression)', () => {
  test('findStoresByCodes looks up by id (the source Store ID IS store.id now) and batches a 250-code lookup into requests of <=100 each, with no duplicates or losses', async () => {
    const storeCodes = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const storeTable = storeCodes.map((code) => ({ id: code, storeCode: code, name: `Store ${code}` }));
    const { from, inCalls } = createFakeFrom({ store: storeTable });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes(storeCodes);

    // Batched into multiple requests, each within a safe size.
    expect(inCalls.length).toBeGreaterThan(1);
    for (const call of inCalls) {
      expect(call.column).toBe('id');
      expect(call.values.length).toBeLessThanOrEqual(100);
      // A single batch's filter value would never approach the ~16KB URL limit.
      expect(call.values.join(',').length).toBeLessThan(5000);
    }
    // Every code across every batch, concatenated, reconstructs the original list exactly once each.
    expect(inCalls.flatMap((c) => c.values)).toEqual(storeCodes);

    // Results are correct and complete — nothing lost or duplicated by batching.
    expect(result.size).toBe(250);
    for (const code of storeCodes) expect(result.get(code)).toMatchObject({ id: code, storeCode: code });
  });

  test('createStores inserts the Excel Store ID as store.id directly — never a generated UUID', async () => {
    const { from, insertCalls } = createFakeFrom({ store: [] });
    mockFromImpl = from;

    const created = await repo.createStores([{ storeCode: '1001', name: 'New Store' }]);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].payload[0].id).toBe('1001');
    expect(created[0].id).toBe('1001');
    expect(created[0].id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i); // not UUID-shaped
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

  // Regression test for a real bug found live: a single batch (up to 100 store ids) can easily
  // match more rows than PostgREST's default per-request page cap (confirmed live: 1023 real
  // matching rows came back as exactly 1000, no error) — findExistingReportKeys used to read
  // each batch only once, so a store with a long sales history silently lost some of its
  // "already exists" keys, misclassifying real updates as brand-new inserts (the app-level
  // upsert still correctly overwrote them via ON CONFLICT, so no data was actually lost, but the
  // reported inserted/updated counts were wrong and looked like the import hadn't really landed).
  test('findExistingReportKeys finds every matching key even when a single batch matches more than 1000 rows (PostgREST default page cap)', async () => {
    const storeIds = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']; // both fit in one 100-id batch
    const rows = [];
    for (const storeId of storeIds) {
      for (let d = 0; d < 600; d++) {
        const date = new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString().slice(0, 10);
        rows.push({ store_id: storeId, report_date: date });
      }
    }
    const { from } = createFakeFrom({ sales_report: rows });
    mockFromImpl = from;

    const dates = [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2030, 0, 1))]; // wide enough to cover every row above
    const keys = await repo.findExistingReportKeys(storeIds, dates);

    expect(rows.length).toBeGreaterThan(1000); // sanity: this test only proves something if the real match count exceeds the page cap
    expect(keys.size).toBe(rows.length); // every single one found, not capped at 1000
  });

  test('an empty id list never issues a request (existing short-circuit is preserved)', async () => {
    const { from } = createFakeFrom({ store: [] });
    mockFromImpl = from;

    const result = await repo.findStoresByCodes([]);

    expect(from).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});

describe('salesReportRepository — upsertRecords (ON CONFLICT (store_id, report_date) DO UPDATE)', () => {
  test('a new (store_id, report_date) key is inserted with a generated id and created_at', async () => {
    const { from, upsertCalls } = createFakeFrom({ sales_report: [] });
    mockFromImpl = from;

    const count = await repo.upsertRecords([{ store_id: '1109', report_date: '2026-07-10', gross_actual: 100, updated_at: '2026-08-27T00:00:00.000Z' }]);

    expect(count).toBe(1);
    expect(upsertCalls[0].options).toEqual({ onConflict: 'store_id,report_date' });
    expect(upsertCalls[0].payload[0].id).toBeUndefined(); // never sent — the DB assigns it on insert
    expect(upsertCalls[0].payload[0].created_at).toBeUndefined(); // never sent — the DB defaults it on insert
  });

  test('an existing (store_id, report_date) key is overwritten in place — not duplicated, and no 23505 unique-violation occurs', async () => {
    const table = {
      sales_report: [{
        id: 'existing-uuid-1',
        store_id: '1108',
        report_date: '2026-07-09',
        gross_actual: 100,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }],
    };
    const { from } = createFakeFrom(table);
    mockFromImpl = from;

    const count = await repo.upsertRecords([{ store_id: '1108', report_date: '2026-07-09', gross_actual: 999, updated_at: '2026-08-27T12:00:00.000Z' }]);

    expect(count).toBe(1);
    expect(table.sales_report).toHaveLength(1); // still exactly one row for this key — never a second one
    const row = table.sales_report[0];
    expect(row.id).toBe('existing-uuid-1'); // PK untouched by the update
    expect(row.gross_actual).toBe(999); // overwritten with the new file's data — the file is the source of truth
    expect(row.created_at).toBe('2026-01-01T00:00:00.000Z'); // preserved — never part of the update payload
    expect(row.updated_at).toBe('2026-08-27T12:00:00.000Z'); // refreshed to record this import
  });

  test('a batch smaller than WRITE_BATCH_SIZE (2000) still sends exactly one upsert call', async () => {
    const { from, upsertCalls } = createFakeFrom({ sales_report: [] });
    mockFromImpl = from;
    const records = Array.from({ length: 500 }, (_, i) => ({ store_id: String(i), report_date: '2026-07-09', updated_at: 'x' }));

    const count = await repo.upsertRecords(records);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload).toHaveLength(500);
    expect(count).toBe(500);
  });

  // Regression coverage for the chunked-write rework: a very large file (100k+ rows) used to
  // go through as one single upsert call with no way to report real progress mid-write and no
  // way to avoid sending the whole file as one giant request body — see upsertRecords' own doc
  // comment for the tradeoff (each WRITE_BATCH_SIZE-row chunk is still atomic on its own, the
  // whole file no longer is as a unit; safe to retry since the upsert is idempotent per key).
  test('a file larger than WRITE_BATCH_SIZE is split into multiple upsert calls, each within the size limit, and every row still lands', async () => {
    const { from, upsertCalls } = createFakeFrom({ sales_report: [] });
    mockFromImpl = from;
    const records = Array.from({ length: 4500 }, (_, i) => ({ store_id: String(i), report_date: '2026-07-09', updated_at: 'x' }));

    const count = await repo.upsertRecords(records);

    expect(upsertCalls.length).toBeGreaterThan(1); // never one giant call for a large file
    for (const call of upsertCalls) expect(call.payload.length).toBeLessThanOrEqual(2000);
    expect(upsertCalls.reduce((sum, c) => sum + c.payload.length, 0)).toBe(4500); // every record covered exactly once, no gaps or overlaps
    expect(count).toBe(4500);
  });

  test('onBatchComplete fires once per chunk with real, monotonically increasing rowsWrittenSoFar and the correct totalRows', async () => {
    const { from } = createFakeFrom({ sales_report: [] });
    mockFromImpl = from;
    const records = Array.from({ length: 4500 }, (_, i) => ({ store_id: String(i), report_date: '2026-07-09', updated_at: 'x' }));
    const onBatchComplete = jest.fn();

    await repo.upsertRecords(records, { onBatchComplete });

    expect(onBatchComplete).toHaveBeenCalledTimes(3); // 2000 + 2000 + 500
    const calls = onBatchComplete.mock.calls.map(([arg]) => arg);
    for (const call of calls) expect(call.totalRows).toBe(4500);
    const progressValues = calls.map((c) => c.rowsWrittenSoFar).sort((a, b) => a - b);
    expect(progressValues).toEqual([2000, 4000, 4500]); // every chunk's contribution accounted for exactly once
  });

  test('an empty records list never issues a request', async () => {
    const { from, upsertCalls } = createFakeFrom({ sales_report: [] });
    mockFromImpl = from;

    const count = await repo.upsertRecords([]);

    expect(count).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });

  test('propagates the error from a failing chunk (a single-chunk file still writes nothing on failure)', async () => {
    mockFromImpl = () => ({
      upsert: () => ({ select: () => Promise.resolve({ data: null, error: new Error('constraint violation') }) }),
    });

    await expect(repo.upsertRecords([{ store_id: '1108', report_date: '2026-07-09', updated_at: 'x' }])).rejects.toThrow('constraint violation');
  });
});
