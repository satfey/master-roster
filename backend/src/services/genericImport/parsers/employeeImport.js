const supabase = require('../../../config/supabase');

// Excel header is "store_code" (confirmed from the actual company file);
// the underlying `store` table column is named "storeCode" (camelCase,
// confirmed live against the DB) — these two are intentionally different
// strings, do not conflate them.
const requiredColumns = ['fullName', 'store_code'];

/** Pre-fetches every store referenced by store_code so parseRow can resolve FKs synchronously. */
async function buildContext(rows) {
  const codes = [...new Set(rows.map((r) => (r.store_code ? String(r.store_code).trim() : null)).filter(Boolean))];
  let stores = [];
  if (codes.length) {
    const { data, error } = await supabase.from('store').select('*').in('storeCode', codes);
    if (error) throw error;
    stores = data;
  }
  return { storesByCode: new Map(stores.map((s) => [s.storeCode, s])) };
}

function parseRow(row, ctx) {
  const errors = [];

  const fullName = row.fullName ? String(row.fullName).trim() : '';
  if (!fullName) errors.push('Missing fullName');

  const storeCode = row.store_code ? String(row.store_code).trim() : '';
  let storeId = null;
  if (!storeCode) {
    errors.push('Missing store_code');
  } else {
    const store = ctx.storesByCode.get(storeCode);
    if (!store) errors.push(`Unknown store_code: ${storeCode}`);
    else storeId = store.id;
  }

  let hourlyRate = null;
  if (row.hourlyRate !== undefined && row.hourlyRate !== null && row.hourlyRate !== '') {
    hourlyRate = Number(row.hourlyRate);
    if (Number.isNaN(hourlyRate)) errors.push('Invalid hourlyRate');
  }

  // The Excel format has an Email column, but employee.email does not exist
  // in the current database schema (verified against the live `employee`
  // table — columns are id, store_id, full_name, position, hourly_rate,
  // is_active). Email is intentionally not read into `data` below: read row
  // shape stays compatible with the fixed company format, nothing is lost
  // for the columns that DO exist, and we never send a column Supabase
  // would reject. Wire it up once an email column actually exists.
  return {
    errors,
    data: {
      full_name: fullName,
      store_id: storeId,
      position: row.position ? String(row.position).trim() : null,
      hourly_rate: hourlyRate,
    },
  };
}

module.exports = { model: 'employee', requiredColumns, buildContext, parseRow };
