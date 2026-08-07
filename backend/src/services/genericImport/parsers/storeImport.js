const supabase = require('../../../config/supabase');

const requiredColumns = ['name'];

/** Pre-fetches existing store codes so parseRow can catch unique-constraint violations before insert. */
async function buildContext() {
  const { data: stores, error } = await supabase.from('store').select('code').not('code', 'is', null);
  if (error) throw error;
  return { existingCodes: new Set(stores.map((s) => s.code)), seenCodes: new Set() };
}

function parseRow(row, ctx) {
  const errors = [];

  const name = row.name ? String(row.name).trim() : '';
  if (!name) errors.push('Missing name');

  const code = row.code !== undefined && row.code !== null && row.code !== '' ? String(row.code).trim() : null;
  if (code) {
    if (ctx.existingCodes.has(code)) errors.push(`Duplicate store code (already exists): ${code}`);
    else if (ctx.seenCodes.has(code)) errors.push(`Duplicate store code in file: ${code}`);
    else ctx.seenCodes.add(code);
  }

  return { errors, data: { name, code, region: row.region ? String(row.region).trim() : null } };
}

module.exports = { model: 'store', requiredColumns, buildContext, parseRow };
