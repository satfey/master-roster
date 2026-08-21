const { readFirstSheetAsJson } = require('../utils/excelReader');
const supabase = require('../config/supabase');

/**
 * Expected columns: name, region
 */
async function importStores(buffer) {
  const rows = await readFirstSheetAsJson(buffer);
  let imported = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const { data: existing, error: findError } = await supabase
        .from('store')
        .select('id')
        .eq('name', String(row.name))
        .maybeSingle();
      if (findError) throw findError;

      if (existing) {
        const { error } = await supabase.from('store').update({ region: row.region || null }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('store').insert({ name: String(row.name), region: row.region || null });
        if (error) throw error;
      }
      imported++;
    } catch (err) {
      errors.push({ row: row.__row, message: err.message });
    }
  }

  return { imported, errors, total: rows.length };
}

module.exports = { importStores };
