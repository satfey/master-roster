// Uses the real jwt.js (not mocked) so token signing/verification is
// genuinely exercised end-to-end — only the Supabase user lookup is faked.
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

let mockFromImpl;
jest.mock('../../config/supabase', () => ({ from: (...args) => mockFromImpl(...args) }));

const jwt = require('jsonwebtoken');
const { signToken } = require('../../utils/jwt');
const authenticate = require('../authenticate');

/**
 * Minimal fake supabase-js query builder: .select().eq().eq().maybeSingle() for `user`,
 * .select().eq() (awaited directly) for `store`, .select().ilike() (awaited directly) for
 * `area_coach`. `coaches` is a plain name -> id map; the ilike match is case-insensitive to
 * mirror PostgREST's real ilike, so a test can prove casing does not break the name fallback.
 */
function createFakeFrom({ usersById = {}, storesByAreaCoach = {}, coaches = {} } = {}) {
  return jest.fn((table) => {
    const state = { filters: [], ilike: null };
    const builder = {
      select: jest.fn(() => builder),
      ilike: jest.fn((col, val) => {
        state.ilike = [col, val];
        return builder;
      }),
      eq: jest.fn((col, val) => {
        state.filters.push([col, val]);
        return builder;
      }),
      maybeSingle: jest.fn(async () => {
        if (table !== 'user') throw new Error(`unexpected maybeSingle() on ${table}`);
        const idFilter = state.filters.find(([c]) => c === 'id');
        const activeFilter = state.filters.some(([c, v]) => c === 'is_active' && v === true);
        const row = idFilter ? usersById[idFilter[1]] : null;
        if (!row || (activeFilter && row.is_active === false)) return { data: null, error: null };
        return { data: row, error: null };
      }),
      then(resolve, reject) {
        if (table === 'area_coach') {
          const wanted = String(state.ilike?.[1] ?? '').toLowerCase();
          const matches = Object.entries(coaches)
            .filter(([name]) => name.toLowerCase() === wanted)
            .map(([, id]) => ({ id }));
          return Promise.resolve({ data: matches, error: null }).then(resolve, reject);
        }
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
  /**
   * The account -> area_coach link. store.area_coach_id has always said which coach owns a store;
   * these cover the other direction, which the `user` table has no column for in this database.
   */
  describe('resolving which area_coach an AREA_COACH login is', () => {
    async function runAs(userRow, fakeFromOptions) {
      mockFromImpl = createFakeFrom({ usersById: { 'user-1': userRow }, ...fakeFromOptions });
      const req = makeReq(signToken({ userId: 'user-1' }));
      const res = makeRes();
      await authenticate(req, res, jest.fn());
      return req.user;
    }

    test('falls back to full_name when the user row has no area_coach_id', async () => {
      const user = await runAs(
        makeUserRow({ role: { name: 'AREA_COACH', permissions: [] }, full_name: 'JIRASAK BUNCHUI', area_coach_id: null }),
        { coaches: { 'JIRASAK BUNCHUI': 'ac-jirasak' }, storesByAreaCoach: { 'ac-jirasak': ['1001', '1002'] } }
      );

      expect(user.areaStoreIds).toEqual(['1001', '1002']);
    });

    test('the name fallback is case-insensitive', async () => {
      const user = await runAs(
        makeUserRow({ role: { name: 'AREA_COACH', permissions: [] }, full_name: 'jirasak bunchui', area_coach_id: null }),
        { coaches: { 'JIRASAK BUNCHUI': 'ac-jirasak' }, storesByAreaCoach: { 'ac-jirasak': ['1001'] } }
      );

      expect(user.areaStoreIds).toEqual(['1001']);
    });

    test('an ambiguous name resolves to NO stores rather than guessing a coach', async () => {
      const user = await runAs(
        makeUserRow({ role: { name: 'AREA_COACH', permissions: [] }, full_name: 'Somchai', area_coach_id: null }),
        { coaches: { Somchai: 'ac-a', somchai: 'ac-b' }, storesByAreaCoach: { 'ac-a': ['1001'], 'ac-b': ['2002'] } }
      );

      expect(user.areaStoreIds).toEqual([]);
    });

    test('a name matching no coach resolves to no stores', async () => {
      const user = await runAs(
        makeUserRow({ role: { name: 'AREA_COACH', permissions: [] }, full_name: 'Test Area Coach', area_coach_id: null }),
        { coaches: { 'JIRASAK BUNCHUI': 'ac-jirasak' }, storesByAreaCoach: { 'ac-jirasak': ['1001'] } }
      );

      expect(user.areaStoreIds).toEqual([]);
    });

    test('an explicit area_coach_id wins over a name that points somewhere else', async () => {
      const user = await runAs(
        makeUserRow({ role: { name: 'AREA_COACH', permissions: [] }, full_name: 'JIRASAK BUNCHUI', area_coach_id: 'ac-explicit' }),
        { coaches: { 'JIRASAK BUNCHUI': 'ac-jirasak' }, storesByAreaCoach: { 'ac-explicit': ['9001'], 'ac-jirasak': ['1001'] } }
      );

      expect(user.areaStoreIds).toEqual(['9001']);
    });

    test('a non-AREA_COACH whose name happens to match a coach gets NO area stores', async () => {
      const user = await runAs(
        makeUserRow({ role: { name: 'STORE_MANAGER', permissions: [] }, full_name: 'JIRASAK BUNCHUI', store_id: '1001' }),
        { coaches: { 'JIRASAK BUNCHUI': 'ac-jirasak' }, storesByAreaCoach: { 'ac-jirasak': ['1001', '1002'] } }
      );

      expect(user.areaStoreIds).toEqual([]);
    });
  });
});
