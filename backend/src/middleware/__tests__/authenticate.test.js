// Uses the real jwt.js (not mocked) so token signing/verification is
// genuinely exercised end-to-end — only the Supabase user lookup is faked.
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const jwt = require('jsonwebtoken');
const { signToken } = require('../../utils/jwt');
const authenticate = require('../authenticate');

/** Minimal fake supabase-js query builder: .select().eq().eq().maybeSingle() for `users`, .select().eq() (awaited directly) for `store`. */
function createFakeFrom({ usersById = {}, storesByAreaCoach = {} } = {}) {
  return jest.fn((table) => {
    const state = { filters: [] };
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn((col, val) => {
        state.filters.push([col, val]);
        return builder;
      }),
      maybeSingle: jest.fn(async () => {
        if (table !== 'users') throw new Error(`unexpected maybeSingle() on ${table}`);
        const idFilter = state.filters.find(([c]) => c === 'id');
        const activeFilter = state.filters.some(([c, v]) => c === 'is_active' && v === true);
        const row = idFilter ? usersById[idFilter[1]] : null;
        if (!row || (activeFilter && row.is_active === false)) return { data: null, error: null };
        return { data: row, error: null };
      }),
      then(resolve, reject) {
        if (table !== 'store') return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        const areaCoachFilter = state.filters.find(([c]) => c === 'area_coach_id');
        const ids = areaCoachFilter ? storesByAreaCoach[areaCoachFilter[1]] || [] : [];
        return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
}

function makeUserRow(overrides = {}) {
  return {
    id: 'user-1',
    full_name: 'Test User',
    email: 'test@example.com',
    store_id: null,
    area_coach_id: null,
    is_active: true,
    role: { name: 'STORE_MANAGER', permissions: ['sales:view'] },
    ...overrides,
  };
}

function makeReq(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('authenticate middleware', () => {
  test('a valid token for an active user attaches the correct req.user shape', async () => {
    const userRow = makeUserRow({ role: { name: 'STORE_MANAGER', permissions: ['sales:view'] }, store_id: '1001' });
    mockFromImpl = createFakeFrom({ usersById: { 'user-1': userRow } });
    const token = signToken({ userId: 'user-1' });
    const req = makeReq(token);
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      role: 'STORE_MANAGER',
      permissions: ['sales:view'],
      storeId: '1001',
      areaStoreIds: [],
    });
  });

  test('an AREA_COACH user gets areaStoreIds resolved from their area_coach_id', async () => {
    const userRow = makeUserRow({ role: { name: 'AREA_COACH', permissions: ['branch:compare'] }, area_coach_id: 'ac-1' });
    mockFromImpl = createFakeFrom({ usersById: { 'user-1': userRow }, storesByAreaCoach: { 'ac-1': ['1001', '1002'] } });
    const req = makeReq(signToken({ userId: 'user-1' }));
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(req.user.areaStoreIds).toEqual(['1001', '1002']);
  });

  test('missing Authorization header is rejected with 401, next() never called', async () => {
    const req = makeReq(null);
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('a malformed Authorization header (no Bearer scheme) is rejected with 401', async () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('an invalid/tampered token is rejected with 401', async () => {
    const req = makeReq('not-a-real-token');
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('an expired token is rejected with 401', async () => {
    const expiredToken = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET, { expiresIn: -1 });
    const req = makeReq(expiredToken);
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('a valid token for a since-deactivated user is rejected with 401', async () => {
    const userRow = makeUserRow({ is_active: false });
    mockFromImpl = createFakeFrom({ usersById: { 'user-1': userRow } });
    const req = makeReq(signToken({ userId: 'user-1' }));
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('a valid token for a deleted user (no matching row at all) is rejected with 401', async () => {
    mockFromImpl = createFakeFrom({ usersById: {} });
    const req = makeReq(signToken({ userId: 'ghost-user' }));
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
