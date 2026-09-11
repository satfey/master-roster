// employeeScope reads the employee's owning store, so the Supabase client is mocked down to the
// exact chain it uses: from('employee').select('store_id').eq('id', ...).maybeSingle().
// Rebuilt in beforeEach because jest.clearAllMocks() clears implementations too.
const mockMaybeSingle = jest.fn();
const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const { employeeScope } = require('../employeeScope');

function makeReq({ role, storeId = null, areaStoreIds = [], body = {} }) {
  return { user: { role, storeId, areaStoreIds }, params: { id: 'emp-1' }, body };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/** The employee the mocked lookup returns (null for "no such employee"). */
function employeeBelongsTo(storeId) {
  mockMaybeSingle.mockResolvedValue({ data: storeId === null ? null : { store_id: storeId }, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }));
});

describe('employeeScope — ownership check for /employee/:id (the id is an employee id, not a store id)', () => {
  test('a Store Manager may edit an employee of their own store', async () => {
    employeeBelongsTo('1001');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("SECURITY: a Store Manager cannot edit another store's employee", async () => {
    employeeBelongsTo('2002');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('SECURITY: their own employee cannot be MOVED to a store they do not own', async () => {
    employeeBelongsTo('1001');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001', body: { storeId: '2002' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("SECURITY: another store's employee cannot be PULLED into their own store", async () => {
    employeeBelongsTo('2002');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001', body: { storeId: '1001' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('a move within the caller\'s own store is allowed', async () => {
    employeeBelongsTo('1001');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001', body: { storeId: '1001' } }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('an Area Coach may move an employee between two stores inside their area', async () => {
    employeeBelongsTo('1005');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'AREA_COACH', areaStoreIds: ['1005', '1006'], body: { storeId: '1006' } }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('SECURITY: an Area Coach cannot move an employee out of their area', async () => {
    employeeBelongsTo('1005');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'AREA_COACH', areaStoreIds: ['1005', '1006'], body: { storeId: '9999' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('ADMIN is unrestricted and never reads the employee', async () => {
    employeeBelongsTo('9999');
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'ADMIN', body: { storeId: '1234' } }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('an unknown employee is a 404', async () => {
    employeeBelongsTo(null);
    const res = makeRes();
    const next = jest.fn();

    await employeeScope(makeReq({ role: 'STORE_MANAGER', storeId: '1001' }), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});
