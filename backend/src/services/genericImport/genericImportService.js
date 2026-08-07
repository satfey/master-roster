const { readFirstSheetAsJson } = require('../../utils/excelReader');
const { getImportDefinition, availableEntities } = require('./importRegistry');
const repo = require('../../repositories/genericImportRepository');

/**
 * Validates every row up front and only inserts if the whole file is clean —
 * a partially-valid file is rejected with the offending row numbers rather
 * than importing what it can, so callers always know exactly what to fix.
 */
async function importGeneric(entity, buffer) {
  const definition = getImportDefinition(entity);
  if (!definition) {
    throw Object.assign(new Error(`Unknown import entity "${entity}". Available: ${availableEntities.join(', ')}`), {
      status: 400,
    });
  }

  const rows = await readFirstSheetAsJson(buffer);
  if (rows.length === 0) {
    throw Object.assign(new Error('The uploaded file has no data rows'), { status: 400 });
  }

  const missingColumns = definition.requiredColumns.filter((col) => !(col in rows[0]));
  if (missingColumns.length) {
    throw Object.assign(new Error(`Missing required column(s): ${missingColumns.join(', ')}`), { status: 400 });
  }

  const ctx = await definition.buildContext(rows);

  const parsed = rows.map((row) => {
    const { errors, data } = definition.parseRow(row, ctx);
    return { rowNumber: row.__row, errors, data };
  });

  const failedRows = parsed.filter((r) => r.errors.length > 0);

  if (failedRows.length > 0) {
    return {
      success: false,
      total: rows.length,
      inserted: 0,
      failed: failedRows.length,
      errors: failedRows.map((r) => ({ row: r.rowNumber, messages: r.errors })),
    };
  }

  const records = parsed.map((r) => r.data);
  const inserted = await repo.bulkInsert(definition.model, records);

  return { success: true, total: rows.length, inserted, failed: 0 };
}

module.exports = { importGeneric };
