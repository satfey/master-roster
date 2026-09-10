const { storeScope, getAllowedStoreIds } = require('../storeScope');

function makeReq({ role, storeId = null, areaStoreIds = [], params = {}, query = {}, body = {} }) {
  return { user: { role, storeId, areaStoreIds }, params, query, body };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('storeScope', () => {
  test('STORE_MANAGER is rejected from a different store via the :id route param (e.g. GET/PUT /store/:id)', () => {
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001', params: { id: '1005' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('STORE_MANAGER is allowed their own store via the :id route param', () => {
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001', params: { id: '1001' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('STORE_MANAGER is rejected from a different store via req.body.storeId (e.g. POST /roster/auto-generate)', () => {
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001', body: { storeId: '1005' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('STORE_MANAGER is allowed their own store via req.body.storeId', () => {
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001', body: { storeId: '1001' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('AREA_COACH is rejected from a store not in their assigned list via req.query.storeId', () => {
    const req = makeReq({ role: 'AREA_COACH', areaStoreIds: ['1001', '1002'], query: { storeId: '1099' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('AREA_COACH is allowed a store in their assigned list via req.query.storeId', () => {
    const req = makeReq({ role: 'AREA_COACH', areaStoreIds: ['1001', '1002'], query: { storeId: '1002' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('ADMIN and EXECUTIVE are unrestricted regardless of target store', () => {
    for (const role of ['ADMIN', 'EXECUTIVE']) {
      const req = makeReq({ role, storeId: '1001', params: { id: '9999' } });
      const res = makeRes();
      const next = jest.fn();

      storeScope(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  test('no target store id present (e.g. list endpoints with no filter) does not block STORE_MANAGER', () => {
    const req = makeReq({ role: 'STORE_MANAGER', storeId: '1001' });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('an unrecognized role is rejected with 403', () => {
    const req = makeReq({ role: 'SOMETHING_ELSE' });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('getAllowedStoreIds', () => {
  test('ADMIN/EXECUTIVE get null (unrestricted)', () => {
    expect(getAllowedStoreIds({ role: 'ADMIN' })).toBeNull();
    expect(getAllowedStoreIds({ role: 'EXECUTIVE' })).toBeNull();
  });

  test('STORE_MANAGER gets a single-element array of their own store', () => {
    expect(getAllowedStoreIds({ role: 'STORE_MANAGER', storeId: '1001' })).toEqual(['1001']);
  });

  test('AREA_COACH gets their areaStoreIds', () => {
    expect(getAllowedStoreIds({ role: 'AREA_COACH', areaStoreIds: ['1001', '1002'] })).toEqual(['1001', '1002']);
  });
});
