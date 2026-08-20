const { withDisplayStoreId } = require('../storeDisplay');

describe('withDisplayStoreId', () => {
  test('Case 1: storeId in the response is store.id, the canonical Store ID — not a UUID', () => {
    const store = { id: '1001', storeCode: '1001', name: 'Bangna Store' };
    const result = withDisplayStoreId(store);

    expect(result.storeId).toBe('1001');
    expect(result.storeId).toBe(store.id);
    expect(result.id).toBe('1001');
  });

  test('Case 3: multiple stores each keep their own distinct storeId', () => {
    const stores = [
      { id: '1001', storeCode: '1001', name: 'A' },
      { id: '1002', storeCode: '1002', name: 'B' },
      { id: '1003', storeCode: '1003', name: 'C' },
    ];
    expect(stores.map(withDisplayStoreId).map((s) => s.storeId)).toEqual(['1001', '1002', '1003']);
  });

  test('a store with no id gets storeId: null rather than throwing', () => {
    expect(withDisplayStoreId({ id: null, storeCode: null, name: 'A' }).storeId).toBeNull();
  });

  test('passes through null/undefined unchanged', () => {
    expect(withDisplayStoreId(null)).toBeNull();
    expect(withDisplayStoreId(undefined)).toBeUndefined();
  });
});
