// rosterScope proves the caller may touch the roster named in the URL. It says nothing about the
// shift ids in the request body, and that gap used to be enough to reassign another store's
// shifts through a roster you legitimately own. These cover that boundary.

jest.mock('../../config/supabase', () => ({ from: (...args) => global.__mockFrom(...args) }));
jest.mock('../../utils/activityLogger', () => ({ logActivity: jest.fn() }));

const { update } = require('../rosterController');

/**
 * Fake supabase-js builder over an in-memory `shift` table.
 *
 * The shift UPDATE is what's under test, so the filters it applies are recorded exactly: a row is
 * only touched when EVERY .eq() matches, which is how the real `.eq('id', x).eq('roster_id', y)`
 * pair behaves. `.select()` after an update resolves to the rows actually matched, so a shift that
 * belongs to a different roster comes back as an empty array rather than a silent success.
 */
function createFakeFrom({ rosters = {}, shifts = [], employees = [] } = {}) {
  return (table) => {
    const state = { eq: [], inFilter: null, patch: null, op: 'select' };
    const builder = {
      update: (patch) => { state.op = 'update'; state.patch = patch; return builder; },
      select: () => builder,
      eq: (col, val) => { state.eq.push([col, val]); return builder; },
      in: (col, vals) => { state.inFilter = [col, vals]; return builder; },
      single: async () => {
        const id = state.eq.find(([c]) => c === 'id')?.[1];
        const row = rosters[id];
        if (!row) return { data: null, error: { message: 'not found' } };
        if (state.op === 'update') Object.assign(row, state.patch);
        return { data: row, error: null };
      },
      then(resolve, reject) {
        let rows = table === 'shift' ? shifts : table === 'employee' ? employees : [];
        rows = rows.filter((r) => state.eq.every(([c, v]) => r[c] === v));
        if (state.inFilter) rows = rows.filter((r) => state.inFilter[1].includes(r[state.inFilter[0]]));
        if (state.op === 'update') rows.forEach((r) => Object.assign(r, state.patch));
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const MINE = 'roster-mine';
const THEIRS = 'roster-theirs';

function scenario() {
  const shifts = [
    { id: 'shift-mine', roster_id: MINE, employee_id: 'emp-a' },
    { id: 'shift-theirs', roster_id: THEIRS, employee_id: 'emp-x' },
  ];
  const rosters = {
    [MINE]: { id: MINE, store_id: '1001', status: 'DRAFT' },
    [THEIRS]: { id: THEIRS, store_id: '2002', status: 'DRAFT' },
  };
  const employees = [
    { id: 'emp-a', store_id: '1001' },
    { id: 'emp-b', store_id: '1001' },
    { id: 'emp-x', store_id: '2002' },
  ];
  global.__mockFrom = createFakeFrom({ rosters, shifts, employees });
  return { shifts, rosters };
}

const req = (body) => ({ params: { id: MINE }, body, user: { id: 'user-1' } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('rosterController.update — shift ownership', () => {
  test('a shift inside this roster is reassigned', async () => {
    const { shifts } = scenario();
    const res = makeRes();

    await update(req({ shifts: [{ id: 'shift-mine', employeeId: 'emp-b' }] }), res);

    expect(shifts.find((s) => s.id === 'shift-mine').employee_id).toBe('emp-b');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('SECURITY: a shift belonging to ANOTHER roster is refused and left untouched', async () => {
    const { shifts } = scenario();
    const res = makeRes();

    await update(req({ shifts: [{ id: 'shift-theirs', employeeId: 'emp-b' }] }), res);

    expect(shifts.find((s) => s.id === 'shift-theirs').employee_id).toBe('emp-x');
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('SECURITY: a foreign shift smuggled in alongside a legitimate one is refused', async () => {
    const { shifts } = scenario();
    const res = makeRes();

    await update(req({ shifts: [{ id: 'shift-mine', employeeId: 'emp-b' }, { id: 'shift-theirs', employeeId: 'emp-b' }] }), res);

    expect(shifts.find((s) => s.id === 'shift-theirs').employee_id).toBe('emp-x');
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("SECURITY: an employee from another store cannot be assigned, and no shift is written", async () => {
    const { shifts } = scenario();
    const res = makeRes();

    await update(req({ shifts: [{ id: 'shift-mine', employeeId: 'emp-x' }] }), res);

    expect(shifts.find((s) => s.id === 'shift-mine').employee_id).toBe('emp-a');
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a request with no status does not overwrite the roster status', async () => {
    const { rosters } = scenario();
    const res = makeRes();

    await update(req({ shifts: [{ id: 'shift-mine', employeeId: 'emp-b' }] }), res);

    expect(rosters[MINE].status).toBe('DRAFT');
  });

  test('an explicit status is still applied', async () => {
    const { rosters } = scenario();
    const res = makeRes();

    await update(req({ status: 'APPROVED' }), res);

    expect(rosters[MINE].status).toBe('APPROVED');
  });
});
