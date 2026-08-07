const { readFirstSheetAsJson } = require('../utils/excelReader');
const supabase = require('../config/supabase');
const employeeImportDefinition = require('./genericImport/parsers/employeeImport');

/**
 * Expected columns (fixed company Excel format): fullName, Email, store_code, position, hourlyRate (optional)
 * Email is part of the sheet but is not persisted — employee.email doesn't
 * exist in the current database schema (see parseRow in the parser below).
 *
 * Reuses the same field-mapping/validation/store-resolution logic as the
 * generic importer's `employee` entity (services/genericImport/parsers/employeeImport.js)
 * so the two entry points can't drift out of sync again. This endpoint's
 * distinguishing behavior — insert whatever rows are valid, report the rest
 * as per-row errors, rather than the generic importer's all-or-nothing file
 * validation — is preserved.
 */
async function importEmployees(buffer) {
  const rows = await readFirstSheetAsJson(buffer);
  const ctx = await employeeImportDefinition.buildContext(rows);

  let imported = 0;
  const errors = [];

  for (const row of rows) {
    const { errors: rowErrors, data } = employeeImportDefinition.parseRow(row, ctx);
    if (rowErrors.length > 0) {
      errors.push({ row: row.__row, message: rowErrors.join('; ') });
      continue;
    }

    const { error } = await supabase.from('employee').insert(data);
    if (error) {
      errors.push({ row: row.__row, message: error.message });
      continue;
    }
    imported++;
  }

  return { imported, errors, total: rows.length };
}

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

module.exports = { importEmployees, importStores };
