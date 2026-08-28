// Mocks only the Supabase client (not rosterService itself) against a small
// in-memory fake, so generateRoster's real idempotency logic (find existing
// roster -> reuse/reject/create) runs end-to-end. Follows the same
// `mockFromImpl` pattern used by salesReportRepository.test.js.
let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const { generateRoster } = require('../rosterService');

/**
 * Minimal fake supabase-js query builder covering exactly what
 * rosterService.js uses: select/insert/delete, eq (chainable/AND), limit,
 * order, maybeSingle, single, and plain await (delete/insert with no
 * terminal call). The `roster` table enforces the same (store_id,
 * week_start) uniqueness as the real roster_store_id_week_start_key
 * constraint — a regression back to an unconditional insert would surface
 * here as a thrown 23505-shaped error, the same as it would against the
 * real database.
 */
function createFakeFrom(tables) {
  const from = jest.fn((tableName) => {
    const rows = tables[tableName] || (tables[tableName] = []);
    const state = { filters: [], insertPayload: null, insertError: null, deleteMode: false, limit: null };

    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn((col, val) => {
        state.filters.push([col, val]);
        return builder;
      }),
      limit: jest.fn((n) => {
        state.limit = n;
        return builder;
      }),
      order: jest.fn((col, { ascending = true } = {}) => {
        state.orderBy = { col, ascending };
        return builder;
      }),
      insert: jest.fn((payload) => {
        state.insertPayload = Array.isArray(payload) ? payload : [payload];
        if (tableName === 'roster') {
          const dup = state.insertPayload.find((r) => rows.some((existing) => existing.store_id === r.store_id && existing.week_start === r.week_start));
          if (dup) state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "roster_store_id_week_start_key"' };
        }
        return builder;
      }),
      delete: jest.fn(() => {
        state.deleteMode = true;
        return builder;
      }),
      maybeSingle: jest.fn(() => resolveQuery(true)),
      single: jest.fn(() => resolveQuery(false)),
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };

    function matchFilters(list) {
      let matched = list;
      for (const [col, val] of state.filters) matched = matched.filter((r) => r[col] === val);
      return matched;
    }

    async function execute() {
      if (state.insertPayload) {
        if (state.insertError) return { data: null, error: state.insertError };
        const created = state.insertPayload.map((r) => ({ id: r.id || `generated-${tableName}-${rows.length}-${Math.random().toString(36).slice(2)}`, ...r }));
        rows.push(...created);
        return { data: created, error: null };
      }
      if (state.deleteMode) {
        const toDelete = matchFilters(rows);
        const toDeleteIds = new Set(toDelete.map((r) => r.id));
        const remaining = rows.filter((r) => !toDeleteIds.has(r.id));
        rows.length = 0;
        rows.push(...remaining);
        return { data: toDelete, error: null };
      }
      let matched = matchFilters(rows);
      if (state.orderBy) {
        const { col, ascending } = state.orderBy;
        matched = [...matched].sort((a, b) => (ascending ? 1 : -1) * (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
      }
      if (state.limit != null) matched = matched.slice(0, state.limit);
      // The one embedded-select rosterService.js actually issues: the final
      // fetch of `roster` selects `shift(*, employee(*))` alongside it.
      if (tableName === 'roster') {
        matched = matched.map((r) => ({
          ...r,
          shift: (tables.shift || [])
            .filter((s) => s.roster_id === r.id)
            .map((s) => ({ ...s, employee: (tables.employee || []).find((e) => e.id === s.employee_id) || null })),
        }));
      }
      return { data: matched, error: null };
    }

    async function resolveQuery(maybeSingleMode) {
      const { data, error } = await execute();
      if (error) return { data: null, error };
      return { data: maybeSingleMode ? data[0] || null : data[0], error: null };
    }

    return builder;
  });
  return { from };
}

function makeEmployee(id, overrides = {}) {
  return { id, store_id: '1001', is_active: true, last_name: id, ...overrides };
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('rosterService.generateRoster — idempotent per (store_id, week_start)', () => {
  test('A. generating when no roster exists for this store/week creates exactly one roster row', async () => {
    const tables = { employee: [makeEmployee('E1'), makeEmployee('E2')] };
    mockFromImpl = createFakeFrom(tables).from;

    const roster = await generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null });

    expect(roster.status).toBe('DRAFT');
    expect(tables.roster).toHaveLength(1);
    expect(tables.roster[0].store_id).toBe('1001');
    expect(tables.roster[0].week_start).toBe('2026-08-09');
    expect(roster.shift.length).toBeGreaterThan(0);
  });

  test('B. generating twice for the same store/week never creates a second roster row (the reported 23505 bug)', async () => {
    const tables = { employee: [makeEmployee('E1'), makeEmployee('E2')] };
    mockFromImpl = createFakeFrom(tables).from;

    const first = await generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null });
    const second = await generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null });

    expect(tables.roster).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('DRAFT');
  });

  test('C. regenerate=true replaces the DRAFT roster\'s shifts in place, without creating a duplicate roster row', async () => {
    const tables = { employee: [makeEmployee('E1'), makeEmployee('E2')] };
    mockFromImpl = createFakeFrom(tables).from;

    const first = await generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null });
    const firstShiftIds = [...tables.shift.map((s) => s.id)].sort();

    const second = await generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null, regenerate: true });
    const secondShiftIds = [...tables.shift.map((s) => s.id)].sort();

    expect(tables.roster).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(secondShiftIds).not.toEqual(firstShiftIds); // old shifts were actually deleted and fresh ones inserted, not left stacked
  });

  test('D. an existing APPROVED roster is rejected with 409 and nothing is changed', async () => {
    const tables = {
      employee: [makeEmployee('E1')],
      roster: [{ id: 'roster-approved-1', store_id: '1001', week_start: '2026-08-09', status: 'APPROVED', approved_by: 'uuid-user-1' }],
      shift: [{ id: 'shift-existing-1', roster_id: 'roster-approved-1', employee_id: 'E1', shift_date: '2026-08-09', start_time: '08:00', end_time: '16:00', planned_hours: 7 }],
    };
    mockFromImpl = createFakeFrom(tables).from;

    await expect(generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null })).rejects.toMatchObject({ status: 409 });

    expect(tables.roster).toHaveLength(1);
    expect(tables.roster[0].status).toBe('APPROVED');
    expect(tables.shift).toHaveLength(1);
    expect(tables.shift[0].id).toBe('shift-existing-1'); // untouched
  });

  test('D2. an existing PUBLISHED roster is also rejected with 409, not just APPROVED', async () => {
    const tables = {
      employee: [makeEmployee('E1')],
      roster: [{ id: 'roster-pub-1', store_id: '1001', week_start: '2026-08-09', status: 'PUBLISHED', approved_by: 'uuid-user-1' }],
    };
    mockFromImpl = createFakeFrom(tables).from;

    await expect(generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null })).rejects.toMatchObject({ status: 409 });
    expect(tables.roster).toHaveLength(1);
    expect(tables.roster[0].status).toBe('PUBLISHED');
  });

  test('E. if generation fails before any write, an existing DRAFT roster and its shifts remain fully intact', async () => {
    const tables = {
      employee: [], // triggers the existing "No active employees found" failure — before any delete/insert happens
      roster: [{ id: 'roster-draft-1', store_id: '1001', week_start: '2026-08-09', status: 'DRAFT', approved_by: null }],
      shift: [{ id: 'shift-existing-1', roster_id: 'roster-draft-1', employee_id: 'E1', shift_date: '2026-08-09', start_time: '08:00', end_time: '16:00', planned_hours: 7 }],
    };
    mockFromImpl = createFakeFrom(tables).from;

    await expect(generateRoster({ storeId: '1001', weekStart: '2026-08-09', allowedHoursOverride: 1000, approvedBy: null })).rejects.toMatchObject({ status: 400 });

    expect(tables.roster).toHaveLength(1);
    expect(tables.roster[0].status).toBe('DRAFT');
    expect(tables.shift).toHaveLength(1);
    expect(tables.shift[0].id).toBe('shift-existing-1'); // never deleted — the failure happened before the destructive write
  });

  test('F. no migration drops or alters roster_store_id_week_start_key — the fix relies on the existing constraint, not a schema change', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '../../../migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      expect(sql).not.toMatch(/DROP\s+CONSTRAINT\s+roster_store_id_week_start_key/i);
      expect(sql).not.toMatch(/ALTER\s+TABLE\s+roster\b[\s\S]*?\bDROP\b/i);
    }
  });

  test('a genuine duplicate insert attempt against the roster table still fails uniqueness, proving the constraint itself is untouched', async () => {
    const tables = { roster: [{ id: 'roster-1', store_id: '1001', week_start: '2026-08-09', status: 'DRAFT', approved_by: null }] };
    mockFromImpl = createFakeFrom(tables).from;

    const { error } = await require('../../config/supabase')
      .from('roster')
      .insert({ store_id: '1001', week_start: '2026-08-09', status: 'DRAFT', approved_by: null })
      .select()
      .single();

    expect(error).toMatchObject({ code: '23505' });
  });
});
