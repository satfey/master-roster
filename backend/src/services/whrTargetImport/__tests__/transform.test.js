const { transformRows, transformRow, splitLeadingStoreIdFromName, computeCogValidation } = require('../transform');

function rawRow(overrides = {}) {
  return {
    rowNumber: 1,
    type: 'EQ',
    storeCode: 1001,
    monthlySales: 500000,
    whrs: 620,
    productivity: 190.5,
    cog: 100000,
    storeNameRaw: 'Store Name ABC',
    ...overrides,
  };
}

describe('whrTargetImport/transform — splitLeadingStoreIdFromName', () => {
  test('3. splits a leading Store ID off a combined "ID Name" string', () => {
    expect(splitLeadingStoreIdFromName('1001 Store Name ABC')).toEqual({ embeddedStoreId: '1001', storeName: 'Store Name ABC' });
  });

  test('5. preserves the store name exactly after splitting (no truncation/mangling)', () => {
    expect(splitLeadingStoreIdFromName('1001 DQ Central Ladprao Branch')).toEqual({ embeddedStoreId: '1001', storeName: 'DQ Central Ladprao Branch' });
  });

  test('a name with no leading numeric prefix is returned unchanged', () => {
    expect(splitLeadingStoreIdFromName('Store Name ABC')).toEqual({ embeddedStoreId: null, storeName: 'Store Name ABC' });
  });

  test('handles extra whitespace around the id/name boundary', () => {
    expect(splitLeadingStoreIdFromName('  1001    Store Name ABC  ')).toEqual({ embeddedStoreId: '1001', storeName: 'Store Name ABC' });
  });

  test('null/undefined/blank input never throws', () => {
    expect(splitLeadingStoreIdFromName(null)).toEqual({ embeddedStoreId: null, storeName: null });
    expect(splitLeadingStoreIdFromName(undefined)).toEqual({ embeddedStoreId: null, storeName: null });
    expect(splitLeadingStoreIdFromName('   ')).toEqual({ embeddedStoreId: null, storeName: null });
  });

  test('a numeric-only name (no text after the number) has no name left over', () => {
    expect(splitLeadingStoreIdFromName('1001')).toEqual({ embeddedStoreId: null, storeName: '1001' }); // no trailing text -> not a "leading id + name" case, treated as a plain (numeric) name
  });
});

describe('whrTargetImport/transform — computeCogValidation (COG <= 33% of Sales)', () => {
  test('10. COG at or under 33% of Sales passes with no error', () => {
    expect(computeCogValidation(165000, 500000)).toEqual({ cogPercent: 0.33, errors: [] }); // exactly 33%
    expect(computeCogValidation(100000, 500000)).toEqual({ cogPercent: 0.2, errors: [] });
  });

  test('11. COG over 33% of Sales fails with a clear, specific reason', () => {
    const result = computeCogValidation(200000, 500000);
    expect(result.cogPercent).toBe(0.4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/40\.0%/);
    expect(result.errors[0]).toMatch(/33%/);
    expect(result.errors[0]).toMatch(/200000/);
    expect(result.errors[0]).toMatch(/500000/);
  });

  test('12. Sales = 0 never divides by zero — a zero/absent COG alongside it is not an error', () => {
    expect(computeCogValidation(0, 0)).toEqual({ cogPercent: null, errors: [] });
    expect(computeCogValidation(null, 0)).toEqual({ cogPercent: null, errors: [] });
  });

  test('12. Sales = 0 with a nonzero COG is reported clearly, not silently passed or a fabricated percentage', () => {
    const result = computeCogValidation(50000, 0);
    expect(result.cogPercent).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/[Dd]ivision by zero/);
  });

  test('missing Sales with a real COG value is reported, not silently skipped', () => {
    const result = computeCogValidation(50000, null);
    expect(result.cogPercent).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  test('missing COG entirely produces no error (nothing to validate)', () => {
    expect(computeCogValidation(null, 500000)).toEqual({ cogPercent: null, errors: [] });
  });
});

describe('whrTargetImport/transform — transformRow (full row assembly)', () => {
  test('2. & 4. extracts and normalizes store_id from CODE (numeric cell -> canonical string, no float artifacts)', () => {
    const row = transformRow(rawRow({ storeCode: 1001 }), '2026-07-01');
    expect(row.storeId).toBe('1001');
    expect(row.reportStoreId).toBe(1001);
  });

  test('a missing CODE is a validation error, never silently defaulted', () => {
    const row = transformRow(rawRow({ storeCode: null }), '2026-07-01');
    expect(row.storeId).toBeNull();
    expect(row.errors).toContain('Missing CODE (column B)');
  });

  test('6. extracts monthly WHRS', () => {
    expect(transformRow(rawRow({ whrs: 743.5 }), '2026-07-01').whrs).toBe(743.5);
  });

  test('7. extracts monthly Productivity', () => {
    expect(transformRow(rawRow({ productivity: 205.2 }), '2026-07-01').productivity).toBe(205.2);
  });

  test('8. extracts monthly COG', () => {
    expect(transformRow(rawRow({ cog: 123456.78 }), '2026-07-01').cog).toBe(123456.78);
  });

  test('9. extracts monthly Sales', () => {
    expect(transformRow(rawRow({ monthlySales: 987654 }), '2026-07-01').monthlySales).toBe(987654);
  });

  test('carries the caller-supplied reportMonth through unchanged (always derived from the file\'s PERIOD cell upstream, never hardcoded here)', () => {
    expect(transformRow(rawRow(), '2026-11-01').reportMonth).toBe('2026-11-01');
  });

  test('a row with COG over the limit surfaces that error alongside every other extracted field', () => {
    const row = transformRow(rawRow({ monthlySales: 500000, cog: 200000 }), '2026-07-01');
    expect(row.cogPercent).toBe(0.4);
    expect(row.errors.some((e) => e.includes('33%'))).toBe(true);
    expect(row.monthlySales).toBe(500000); // other fields still extracted even though this row will end up invalid
  });

  test('transformRows maps every raw row independently, in order', () => {
    const rows = transformRows([rawRow({ rowNumber: 1, storeCode: 1001 }), rawRow({ rowNumber: 2, storeCode: 1002 })], '2026-07-01');
    expect(rows.map((r) => r.storeId)).toEqual(['1001', '1002']);
  });
});
