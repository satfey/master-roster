// The Staff Management screen's add / change / remove. Only the Supabase boundary is faked; the
// controller, its validation and the shared Employee ID identity rule run for real.

jest.mock('../../config/supabase', () => ({ from: (...args) => global.__mockFrom(...args) }));
jest.mock('../../utils/activityLogger', () => ({ logActivity: jest.fn() }));

const { create, update, remove } = require('../employeeController');

/**
 * In-memory `employee` and `shift` tables behind a supabase-js-shaped builder. Deleting an employee
 * who is referenced by a shift fails with Postgres code 23503, exactly as the real
 * fk_shift_employee ... ON DELETE RESTRICT constraint does.
 */
function createFakeDb({ employees = [], shifts = [] } = {}) {
  const db = { employees: employees.map((e) => ({ ...e })), shifts: shifts.map((s) => ({ ...s })) };

  global.__mockFrom = (table) => {
    const q = { op: 'select', eq: [], in: null, gte: [], patch: null, row: null, head: false };
    const matches = (r) =>
      q.eq.every(([c, v]) => r[c] === v) && (!q.in || q.in[1].includes(r[q.in[0]])) && q.gte.every(([c, v]) => r[c] >= v);

    async function run(single) {
      if (table === 'shift') {
        const rows = db.shifts.filter(matches);
        return { data: q.head ? null : rows, count: rows.length, error: null };
      }
      if (q.op === 'insert') {
        db.employees.push({ ...q.row });
        return { data: single ? { ...q.row } : [{ ...q.row }], error: null };
      }
      if (q.op === 'update') {
        const rows = db.employees.filter(matches);
        rows.forEach((r) => Object.assign(r, q.patch));
        return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r })), error: null };
      }
      if (q.op === 'delete') {
        const rows = db.employees.filter(matches);
        if (rows.some((r) => db.shifts.some((s) => s.employee_id === r.id))) {
          return { data: null, error: { code: '23503', message: 'violates foreign key constraint "fk_shift_employee"' } };
        }
        db.employees = db.employees.filter((r) => !matches(r));
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      const rows = db.employees.filter(matches);
      return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r })), error: null };
    }

    const b = {
      select: (cols, opts) => {
        if (opts && opts.head) q.head = true;
        return b;
      },
      insert: (row) => { q.op = 'insert'; q.row = row; return b; },
      update: (patch) => { q.op = 'update'; q.patch = patch; return b; },
      delete: () => { q.op = 'delete'; return b; },
      eq: (c, v) => { q.eq.push([c, v]); return b; },
      in: (c, vals) => { q.in = [c, vals]; return b; },
      gte: (c, v) => { q.gte.push([c, v]); return b; },
      order: () => b,
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (resolve, reject) => run(false).then(resolve, reject),
    };
    return b;
  };

  return db;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const statusOf = (res) => res.status.mock.calls[0][0];
const bodyOf = (res) => res.json.mock.calls[0][0];
const req = ({ body = {}, params = {} } = {}) => ({ body, params, user: { id: 'u1' } });

const EXISTING = {
  id: '00106922', store_id: '1001', first_name: 'Somchai', last_name: 'Jaidee', position: 'Service Staff',
  position_time_type: 'Full time', is_active: true,
};

beforeEach(() => jest.clearAllMocks());

describe('employeeController.create — adding a person from Staff Management', () => {
  test('a new employee is inserted, active, with the type the roster generator reads', async () => {
    const db = createFakeDb();
    const res = makeRes();

    await create(req({ body: { employeeId: '07999999', storeId: '1001', firstName: 'Nida', lastName: 'Sukjai', position: 'Service Staff', positionTimeType: 'part time' } }), res);

    expect(statusOf(res)).toBe(201);
    expect(db.employees).toHaveLength(1);
    expect(db.employees[0]).toMatchObject({ id: '07999999', store_id: '1001', is_active: true, position_time_type: 'Part time', first_name: 'Nida' });
  });

  test('the employee type is required — an untyped employee would never be scheduled', async () => {
    const db = createFakeDb();
    const res = makeRes();

    await create(req({ body: { employeeId: '07999999', storeId: '1001', firstName: 'Nida' } }), res);

    expect(statusOf(res)).toBe(400);
    expect(db.employees).toHaveLength(0);
  });

  test('a name is required', async () => {
    const db = createFakeDb();
    const res = makeRes();

    await create(req({ body: { employeeId: '07999999', storeId: '1001', positionTimeType: 'Full time' } }), res);

    expect(statusOf(res)).toBe(400);
    expect(db.employees).toHaveLength(0);
  });

  test('REGRESSION: the same ID without its leading zeros is refused, not added as a second person', async () => {
    const db = createFakeDb({ employees: [EXISTING] });
    const res = makeRes();

    await create(req({ body: { employeeId: '106922', storeId: '1001', firstName: 'Somchai', positionTimeType: 'Full time' } }), res);

    expect(statusOf(res)).toBe(409);
    expect(db.employees).toHaveLength(1);
  });

  test('an ID that already works at another store is refused without naming that store', async () => {
    createFakeDb({ employees: [{ ...EXISTING, store_id: '2002' }] });
    const res = makeRes();

    await create(req({ body: { employeeId: '00106922', storeId: '1001', firstName: 'Somchai', positionTimeType: 'Full time' } }), res);

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res).message).not.toContain('2002');
  });

  test('a previously removed employee of the same store is brought back instead of duplicated', async () => {
    const db = createFakeDb({ employees: [{ ...EXISTING, is_active: false }] });
    const res = makeRes();

    await create(req({ body: { employeeId: '106922', storeId: '1001', firstName: 'Somchai', lastName: 'Jaidee', positionTimeType: 'Part time' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(db.employees).toHaveLength(1);
    expect(db.employees[0]).toMatchObject({ id: '00106922', is_active: true, position_time_type: 'Part time' });
  });
});

describe('employeeController.update — partial changes', () => {
  test('only the fields sent are written; everything else is left alone', async () => {
    const db = createFakeDb({ employees: [EXISTING] });
    const res = makeRes();

    await update(req({ params: { id: '00106922' }, body: { positionTimeType: 'part' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(db.employees[0]).toMatchObject({ position_time_type: 'Part time', first_name: 'Somchai', last_name: 'Jaidee', position: 'Service Staff', store_id: '1001' });
  });

  test('an invalid type is refused', async () => {
    const db = createFakeDb({ employees: [EXISTING] });
    const res = makeRes();

    await update(req({ params: { id: '00106922' }, body: { positionTimeType: 'contractor' } }), res);

    expect(statusOf(res)).toBe(400);
    expect(db.employees[0].position_time_type).toBe('Full time');
  });

  test('an empty update is refused', async () => {
    createFakeDb({ employees: [EXISTING] });
    const res = makeRes();

    await update(req({ params: { id: '00106922' }, body: {} }), res);

    expect(statusOf(res)).toBe(400);
  });

  test('an unknown employee is a 404, not a 500', async () => {
    createFakeDb();
    const res = makeRes();

    await update(req({ params: { id: '404404' }, body: { position: 'X' } }), res);

    expect(statusOf(res)).toBe(404);
  });
});

describe('employeeController.remove — deletes from the database', () => {
  test('an employee with no shifts is deleted from the database', async () => {
    const db = createFakeDb({ employees: [EXISTING] });
    const res = makeRes();

    await remove(req({ params: { id: '00106922' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ deleted: true, deactivated: false });
    expect(db.employees).toHaveLength(0);
  });

  test('an employee with roster history is deactivated, keeping that history, and future shifts are counted', async () => {
    const db = createFakeDb({
      employees: [EXISTING],
      shifts: [
        { id: 's-past', employee_id: '00106922', shift_date: '2000-01-01' },
        { id: 's-future-1', employee_id: '00106922', shift_date: '2099-01-01' },
        { id: 's-future-2', employee_id: '00106922', shift_date: '2099-01-02' },
      ],
    });
    const res = makeRes();

    await remove(req({ params: { id: '00106922' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ deleted: false, deactivated: true, futureShiftCount: 2 });
    expect(db.employees).toHaveLength(1);
    expect(db.employees[0].is_active).toBe(false);
    expect(db.shifts).toHaveLength(3); // history untouched
  });

  test('an unknown employee is a 404', async () => {
    createFakeDb();
    const res = makeRes();

    await remove(req({ params: { id: '404404' } }), res);

    expect(statusOf(res)).toBe(404);
  });
});
