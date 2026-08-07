const supabase = require('../../../config/supabase');

const requiredColumns = ['storeCode'];

function parseOptionalNumber(value, errors, label) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) errors.push(`Invalid ${label}`);
  return Number.isNaN(num) ? null : num;
}

/** Pre-fetches every store referenced by storeCode so parseRow can resolve FKs synchronously. */
async function buildContext(rows) {
  const codes = [...new Set(rows.map((r) => (r.storeCode ? String(r.storeCode).trim() : null)).filter(Boolean))];
  let stores = [];
  if (codes.length) {
    const { data, error } = await supabase.from('store').select('*').in('code', codes);
    if (error) throw error;
    stores = data;
  }
  return { storesByCode: new Map(stores.map((s) => [s.code, s])) };
}

function parseRow(row, ctx) {
  const errors = [];

  const storeCode = row.storeCode ? String(row.storeCode).trim() : '';
  let storeId = null;
  if (!storeCode) {
    errors.push('Missing storeCode');
  } else {
    const store = ctx.storesByCode.get(storeCode);
    if (!store) errors.push(`Unknown storeCode: ${storeCode}`);
    else storeId = store.id;
  }

  const targetProductivity = parseOptionalNumber(row.targetProductivity, errors, 'targetProductivity');
  const targetColPercent = parseOptionalNumber(row.targetColPercent, errors, 'targetColPercent');
  const minStaffPerShift = parseOptionalNumber(row.minStaffPerShift, errors, 'minStaffPerShift');

  return {
    errors,
    data: {
      store_id: storeId,
      target_productivity: targetProductivity,
      target_col_percent: targetColPercent,
      min_staff_per_shift: minStaffPerShift,
    },
  };
}

module.exports = { model: 'labor_guideline', requiredColumns, buildContext, parseRow };
