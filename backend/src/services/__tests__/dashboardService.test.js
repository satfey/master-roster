// Mocks only the Supabase client (not the service) so the real
// storeId mapping logic in dashboardService.js runs end-to-end.
let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const { getStoreProductivity, getCompanyDashboard } = require('../dashboardService');

/** Minimal fake supabase-js query builder covering the chains dashboardService.js uses. */
function createFakeFrom(tables) {
  const calls = [];
  const from = jest.fn((tableName) => {
    const rows = tables[tableName] || [];
    const filters = [];
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn((col, val) => { filters.push(['eq', col, val]); return builder; }),
      gte: jest.fn((col, val) => { filters.push(['gte', col, val]); return builder; }),
      lte: jest.fn((col, val) => { filters.push(['lte', col, val]); return builder; }),
      order: jest.fn(() => builder),
      in: jest.fn((col, vals) => { filters.push(['in', col, vals]); return builder; }),
      limit: jest.fn(() => builder),
      maybeSingle: jest.fn(async () => {
        const data = matchRows();
        return { data: data[0] || null, error: null };
      }),
      then(resolve, reject) {
        return Promise.resolve({ data: matchRows(), error: null }).then(resolve, reject);
      },
    };
    function matchRows() {
      calls.push({ table: tableName, filters: [...filters] });
      return rows.filter((row) =>
        filters.every(([op, col, val]) => {
          const rowVal = row[col];
          if (op === 'eq') return rowVal === val;
          if (op === 'gte') return rowVal >= val;
          if (op === 'lte') return rowVal <= val;
          if (op === 'in') return val.includes(rowVal);
          return true;
        })
      );
    }
    return builder;
  });
  return { from, calls };
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('dashboardService — storeId is store.id, the canonical Store ID (not a UUID)', () => {
  test('getStoreProductivity returns the storeId it was given directly — store.id IS the canonical id, no extra lookup needed', async () => {
    const { from, calls } = createFakeFrom({ sales_record: [], sales_forecast: [], shift: [], labor_guideline: [] });
    mockFromImpl = from;

    const result = await getStoreProductivity({ storeId: '1001' });

    expect(result.storeId).toBe('1001');
    expect(calls.some((c) => c.table === 'store')).toBe(false); // no extra store lookup — the id passed in already is the canonical one
  });

  test('7. API returns storeId as the source Store ID string, not a UUID', async () => {
    const { from } = createFakeFrom({ sales_record: [], sales_forecast: [], shift: [], labor_guideline: [] });
    mockFromImpl = from;

    const result = await getStoreProductivity({ storeId: '1001' });

    expect(result.storeId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  test('Case 3: getCompanyDashboard lists multiple stores, each with its own storeId', async () => {
    const stores = [
      { id: '1001', storeCode: '1001', name: 'A', region: null, area_coach_id: null },
      { id: '1002', storeCode: '1002', name: 'B', region: null, area_coach_id: null },
      { id: '1003', storeCode: '1003', name: 'C', region: null, area_coach_id: null },
    ];
    const { from } = createFakeFrom({ store: stores, sales_record: [], sales_forecast: [], shift: [], labor_guideline: [] });
    mockFromImpl = from;

    const result = await getCompanyDashboard({ role: 'ADMIN' });

    expect(result.stores.map((r) => r.storeId)).toEqual(['1001', '1002', '1003']);
    expect(result.stores.map((r) => r.store.storeId)).toEqual(['1001', '1002', '1003']); // embedded store entity also enriched
    expect(result.stores.map((r) => r.store.id)).toEqual(['1001', '1002', '1003']);
  });
});
