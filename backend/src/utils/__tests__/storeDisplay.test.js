const { withDisplayStoreId } = require('../storeDisplay');

describe('withDisplayStoreId', () => {
  test('Case 1: storeId in the response is store.storeCode, not the UUID primary key', () => {
    const store = { id: 'baf9e13d-fd30-45c2-8ed3-000000000001', storeCode: '1001', name: 'Bangna Store' };
    const result = withDisplayStoreId(store);

    expect(result.storeId).toBe('1001');
    expect(result.storeId).not.toBe(store.id);
    expect(result.id).toBe('baf9e13d-fd30-45c2-8ed3-000000000001'); // UUID still present under `id` — not removed
  });

  test('Case 3: multiple stores each keep their own distinct storeId', () => {
    const stores = [
      { id: 'uuid-1', storeCode: '1001', name: 'A' },
      { id: 'uuid-2', storeCode: '1002', name: 'B' },
      { id: 'uuid-3', storeCode: '1003', name: 'C' },
    ];
    expect(stores.map(withDisplayStoreId).map((s) => s.storeId)).toEqual(['1001', '1002', '1003']);
  });

  test('a store with no storeCode yet gets storeId: null rather than throwing', () => {
    expect(withDisplayStoreId({ id: 'uuid-1', storeCode: null, name: 'A' }).storeId).toBeNull();
  });

  test('passes through null/undefined unchanged', () => {
    expect(withDisplayStoreId(null)).toBeNull();
    expect(withDisplayStoreId(undefined)).toBeUndefined();
  });
});
