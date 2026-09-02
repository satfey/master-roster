const supabase = require('../../../config/supabase');

// store.id IS the canonical Store ID (e.g. "1001") — a VARCHAR primary key
// with no default, not an auto-generated UUID (same convention every other
// importer in this codebase already follows: salesByHourImport,
// storeMasterImport, salesReportImport). "code" is required here — without
// it there is no id to insert.
const requiredColumns = ['name', 'code'];

/** Pre-fetches existing store ids so parseRow can catch unique-constraint violations before insert. */
async function buildContext() {
  const { data: stores, error } = await supabase.from('store').select('id');
  if (error) throw error;
  return { existingCodes: new Set(stores.map((s) => s.id)), seenCodes: new Set() };
}

function parseRow(row, ctx) {
  const errors = [];

  const name = row.name ? String(row.name).trim() : '';
  if (!name) errors.push('Missing name');

  const code = row.code !== undefined && row.code !== null && row.code !== '' ? String(row.code).trim() : null;
  if (!code) {
    errors.push('Missing code');
  } else if (ctx.existingCodes.has(code)) {
    errors.push(`Duplicate store code (already exists): ${code}`);
  } else if (ctx.seenCodes.has(code)) {
    errors.push(`Duplicate store code in file: ${code}`);
  } else {
    ctx.seenCodes.add(code);
  }

  return { errors, data: { id: code, name, region: row.region ? String(row.region).trim() : null } };
}

module.exports = { model: 'store', requiredColumns, buildContext, parseRow };
