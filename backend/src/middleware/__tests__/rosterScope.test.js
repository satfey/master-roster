// rosterScope reads the roster's owning store from the database, so the Supabase client is mocked
// down to the exact chain it uses: from('roster').select('store_id').eq('id', ...).maybeSingle().
// The chain is rebuilt in beforeEach because jest.clearAllMocks() clears implementations too.
const mockMaybeSingle = jest.fn();
const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const supabase = require('../../config/supabase');
const { rosterScope } = require('../rosterScope');

function makeReq({ role, storeId = null, areaStoreIds = [], rosterId = 'roster-1' }) {
  return { user: { role, storeId, areaStoreIds }, params: { id: rosterId } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/** The roster the mocked lookup will return (or null for "no such roster"). */
function rosterBelongsTo(storeId) {
  mockMaybeSingle.mockResolvedValue({ data: storeId === null ? null : { store_id: storeId }, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
  }));
});

describe('rosterScope — ownership check for /roster/:id (the id is a roster id, not a store id)', () => {
  test('STORE_MANAGER is rejected from a roster belonging to another store', async () => {
    rosterBelongsTo('1514');
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001' });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'You can only access your own store' }));
  });

  test('STORE_MANAGER is allowed a roster belonging to their own store', async () => {
    rosterBelongsTo('1001');
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001' });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  // The whole point of this middleware: rosterController.update/.remove write immediately, with no
  // ownership check of their own, so the rejection must happen before the controller ever runs.
  test('a rejected request never reaches the controller — next() is not called, so no write can happen', async () => {
    rosterBelongsTo('1514');
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001' });
    const next = jest.fn();

    await rosterScope(req, makeRes(), next);

    expect(next).not.toHaveBeenCalled();
  });

  test('ADMIN is unrestricted and the roster is not even looked up', async () => {
    const req = makeReq({ role: 'ADMIN' });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled(); // short-circuits before the query
  });

  test('EXECUTIVE is unrestricted', async () => {
    const req = makeReq({ role: 'EXECUTIVE' });
    const next = jest.fn();

    await rosterScope(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('AREA_COACH is allowed a roster in one of their assigned stores', async () => {
    rosterBelongsTo('1514');
    const req = makeReq({ role: 'AREA_COACH', areaStoreIds: ['1001', '1514'] });
    const next = jest.fn();

    await rosterScope(req, makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('AREA_COACH is rejected from a roster outside their assigned stores', async () => {
    rosterBelongsTo('9999');
    const req = makeReq({ role: 'AREA_COACH', areaStoreIds: ['1001', '1514'] });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a roster id that does not exist returns 404, not a pass-through', async () => {
    rosterBelongsTo(null);
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001' });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('a STORE_MANAGER with no store assigned is allowed nothing', async () => {
    rosterBelongsTo('1001');
    const req = makeReq({ role: 'STORE_MANAGER', storeId: null });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a database error is passed to the error handler, never treated as authorized', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: new Error('db down') });
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001' });
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error)); // forwarded to Express' error handler
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a missing roster id is rejected with 400 rather than querying for undefined', async () => {
    const req = { user: { role: 'STORE_MANAGER', storeId: '1001' }, params: {} };
    const res = makeRes();
    const next = jest.fn();

    await rosterScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
