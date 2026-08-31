process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const { hashPassword } = require('../../utils/password');
const { verifyToken } = require('../../utils/jwt');
const { login, me } = require('../authController');

/** Minimal fake supabase-js query builder for `users` (by email) and `store` (area-coach lookup). */
function createFakeFrom({ usersByEmail = {}, storesByAreaCoach = {} } = {}) {
  return jest.fn((table) => {
    const state = { filters: [] };
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn((col, val) => {
        state.filters.push([col, val]);
        return builder;
      }),
      maybeSingle: jest.fn(async () => {
        const emailFilter = state.filters.find(([c]) => c === 'email');
        const activeFilter = state.filters.some(([c, v]) => c === 'is_active' && v === true);
        const row = emailFilter ? usersByEmail[emailFilter[1]] : null;
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

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  mockFromImpl = undefined;
});

describe('authController.login', () => {
  test('correct email + password returns 200, a valid token, and the identity', async () => {
    const passwordHash = await hashPassword('correct-horse');
    const userRow = { id: 'user-1', full_name: 'Jane Doe', email: 'jane@example.com', store_id: '1001', area_coach_id: null, is_active: true, password_hash: passwordHash, role: { name: 'STORE_MANAGER', permissions: ['sales:view'] } };
    mockFromImpl = createFakeFrom({ usersByEmail: { 'jane@example.com': userRow } });
    const req = { body: { email: 'jane@example.com', password: 'correct-horse' } };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.user).toEqual({ id: 'user-1', name: 'Jane Doe', email: 'jane@example.com', role: 'STORE_MANAGER', permissions: ['sales:view'], storeId: '1001', areaStoreIds: [] });
    expect(typeof body.data.token).toBe('string');
    expect(verifyToken(body.data.token)).toMatchObject({ userId: 'user-1' });
  });

  test('wrong password is rejected with 401 and a generic message', async () => {
    const passwordHash = await hashPassword('correct-horse');
    const userRow = { id: 'user-1', full_name: 'Jane Doe', email: 'jane@example.com', is_active: true, password_hash: passwordHash, role: { name: 'STORE_MANAGER', permissions: [] } };
    mockFromImpl = createFakeFrom({ usersByEmail: { 'jane@example.com': userRow } });
    const req = { body: { email: 'jane@example.com', password: 'wrong-password' } };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Invalid email or password' }));
  });

  test('an unknown email is rejected with 401 and the SAME generic message as a wrong password', async () => {
    mockFromImpl = createFakeFrom({ usersByEmail: {} });
    const req = { body: { email: 'nobody@example.com', password: 'anything' } };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid email or password' }));
  });

  test('a deactivated account is rejected with 401', async () => {
    const passwordHash = await hashPassword('correct-horse');
    const userRow = { id: 'user-1', email: 'jane@example.com', is_active: false, password_hash: passwordHash, role: { name: 'STORE_MANAGER', permissions: [] } };
    mockFromImpl = createFakeFrom({ usersByEmail: { 'jane@example.com': userRow } });
    const req = { body: { email: 'jane@example.com', password: 'correct-horse' } };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('an account with no password set (null password_hash) never crashes and is rejected with 401', async () => {
    const userRow = { id: 'user-1', email: 'jane@example.com', is_active: true, password_hash: null, role: { name: 'STORE_MANAGER', permissions: [] } };
    mockFromImpl = createFakeFrom({ usersByEmail: { 'jane@example.com': userRow } });
    const req = { body: { email: 'jane@example.com', password: 'anything' } };
    const res = makeRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('missing email or password returns 400 before touching the database', async () => {
    mockFromImpl = jest.fn(() => {
      throw new Error('should not query the database');
    });
    const res = makeRes();

    await login({ body: { email: '', password: '' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('an AREA_COACH login resolves areaStoreIds from their area_coach_id', async () => {
    const passwordHash = await hashPassword('correct-horse');
    const userRow = { id: 'user-1', full_name: 'Coach', email: 'coach@example.com', store_id: null, area_coach_id: 'ac-1', is_active: true, password_hash: passwordHash, role: { name: 'AREA_COACH', permissions: ['branch:compare'] } };
    mockFromImpl = createFakeFrom({ usersByEmail: { 'coach@example.com': userRow }, storesByAreaCoach: { 'ac-1': ['1001', '1002', '1003'] } });
    const req = { body: { email: 'coach@example.com', password: 'correct-horse' } };
    const res = makeRes();

    await login(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.user.areaStoreIds).toEqual(['1001', '1002', '1003']);
  });
});

describe('authController.me', () => {
  test('returns req.user as-is (already resolved by the authenticate middleware)', async () => {
    const identity = { id: 'user-1', name: 'Jane', email: 'jane@example.com', role: 'ADMIN', permissions: ['*'], storeId: null, areaStoreIds: [] };
    const res = makeRes();

    await me({ user: identity }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: identity }));
  });
});
