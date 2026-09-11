// shiftScope resolves a shift's owning store two hops away (shift -> roster -> store), so the
// Supabase client is mocked per-table rather than as one fixed chain. The chain is rebuilt in
// beforeEach because jest.clearAllMocks() clears implementations too.
const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const { shiftScope } = require('../shiftScope');

function makeReq({ role, storeId = null, areaStoreIds = [], shiftId = 'shift-1' }) {
  // null means "the caller sent no shiftId" — `undefined` would just trigger the default above.
  return { user: { role, storeId, areaStoreIds }, body: shiftId === null ? {} : { shiftId } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/** shift-1 lives in roster-1; roster-1 belongs to `storeId`. Pass null at either hop for "missing". */
function shiftBelongsTo(storeId, { rosterId = 'roster-1' } = {}) {
  mockFrom.mockImplementation((table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (table === 'shift') return { data: rosterId === null ? null : { roster_id: rosterId }, error: null };
          return { data: storeId === null ? null : { store_id: storeId }, error: null };
        },
      }),
    }),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('shiftScope — ownership check for requests that name a shift, not a store', () => {
  test('SECURITY: a Store Manager is rejected from a shift in another store', async () => {
    shiftBelongsTo('2002');
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('a Store Manager passes for a shift in their own store', async () => {
    shiftBelongsTo('1001');
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('an Area Coach passes for a shift inside their own area', async () => {
    shiftBelongsTo('1005');
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'AREA_COACH', areaStoreIds: ['1005', '1006'] }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('SECURITY: an Area Coach is rejected from a shift outside their area', async () => {
    shiftBelongsTo('9999');
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'AREA_COACH', areaStoreIds: ['1005', '1006'] }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('ADMIN is unrestricted and never even reads the shift', async () => {
    shiftBelongsTo('9999');
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'ADMIN' }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('a missing shiftId is a 400, not a crash', async () => {
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001', shiftId: null }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('an unknown shift is a 404', async () => {
    shiftBelongsTo('1001', { rosterId: null });
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('a shift whose roster is gone has no resolvable owner and is refused, not let through', async () => {
    shiftBelongsTo(null);
    const res = makeRes();
    const next = jest.fn();

    await shiftScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});
