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

  test('ADMIN is unrestricted regardless of target store', () => {
    const req = makeReq({ role: 'ADMIN', storeId: '1001', params: { id: '9999' } });
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  // ADMIN is the only unrestricted role, and the list is closed on purpose: a role nobody has
  // reviewed must not inherit company-wide access just by existing. 'EXECUTIVE' is the concrete
  // case — it used to be hardcoded as unrestricted here while no such row existed in `role`, so
  // creating one would have silently handed out access to every store.
  test('SECURITY: a role that is not one of the three known ones gets NO access, not blanket access', () => {
    for (const role of ['EXECUTIVE', 'AUDITOR', '', null]) {
      const req = makeReq({ role, storeId: '1001', params: { id: '9999' } });
      const res = makeRes();
      const next = jest.fn();

      storeScope(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
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
  test('ADMIN gets null (unrestricted)', () => {
    expect(getAllowedStoreIds({ role: 'ADMIN' })).toBeNull();
  });

  test('SECURITY: an unknown role gets [] (nothing), never null (everything)', () => {
    for (const role of ['EXECUTIVE', 'AUDITOR', undefined]) {
      expect(getAllowedStoreIds({ role })).toEqual([]);
    }
  });

  test('STORE_MANAGER gets a single-element array of their own store', () => {
    expect(getAllowedStoreIds({ role: 'STORE_MANAGER', storeId: '1001' })).toEqual(['1001']);
  });

  test('AREA_COACH gets their areaStoreIds', () => {
    expect(getAllowedStoreIds({ role: 'AREA_COACH', areaStoreIds: ['1001', '1002'] })).toEqual(['1001', '1002']);
  });
});

/**
 * Regression: storeScope used to resolve its target as
 *   req.params.id || req.params.storeId || req.query.storeId || req.body?.storeId
 * i.e. first-value-wins. Write controllers read storeId from the BODY, so a caller could name a
 * store they own in the query string and the store they wanted in the body: the middleware checked
 * one, the controller wrote the other.
 */
describe('storeScope — a request may not name two different stores (query-shadowing bypass)', () => {
  test('SECURITY: query says my store, body says another — refused, not allowed through', () => {
    const req = {
      user: { role: 'STORE_MANAGER', storeId: '1001', areaStoreIds: [] },
      params: {},
      query: { storeId: '1001' },
      body: { storeId: '2002', regenerate: true },
    };
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('SECURITY: a path param that disagrees with the body is refused too', () => {
    const req = {
      user: { role: 'STORE_MANAGER', storeId: '1001', areaStoreIds: [] },
      params: { id: '1001' },
      query: {},
      body: { storeId: '2002' },
    };
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('SECURITY: an ADMIN request is refused as malformed too, rather than resolved silently', () => {
    const req = {
      user: { role: 'ADMIN', storeId: null, areaStoreIds: [] },
      params: {},
      query: { storeId: '1001' },
      body: { storeId: '2002' },
    };
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('the same store named in both query and body agrees, and is allowed', () => {
    const req = {
      user: { role: 'STORE_MANAGER', storeId: '1001', areaStoreIds: [] },
      params: {},
      query: { storeId: '1001' },
      body: { storeId: '1001' },
    };
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a store named only in the body is still validated (the ordinary write case)', () => {
    const req = {
      user: { role: 'STORE_MANAGER', storeId: '1001', areaStoreIds: [] },
      params: {},
      query: {},
      body: { storeId: '2002' },
    };
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('a numeric body storeId and a string query storeId are the same store, not a conflict', () => {
    const req = {
      user: { role: 'STORE_MANAGER', storeId: '1001', areaStoreIds: [] },
      params: {},
      query: { storeId: '1001' },
      body: { storeId: 1001 },
    };
    const res = makeRes();
    const next = jest.fn();

    storeScope(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
