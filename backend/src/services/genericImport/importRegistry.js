/**
 * Registry of tables that can be bulk-imported via POST /api/import.
 *
 * Only master/reference data that's safe to bulk-create straight from a
 * spreadsheet is registered here. System-generated data (rosters, shifts,
 * KPI snapshots, forecasts, actual hours...) and security-sensitive tables
 * (user, role) are intentionally left out — those go through their own
 * flows (e.g. schedule generation, auth) instead of raw Excel import.
 *
 * To open up a new table: add a `parsers/<entity>Import.js` module exporting
 * { model, requiredColumns, buildContext(rows), parseRow(row, ctx) } and
 * register it below.
 */
const parsers = {
  store: require('./parsers/storeImport'),
  laborGuideline: require('./parsers/laborGuidelineImport'),
};

function getImportDefinition(entity) {
  return parsers[entity] || null;
}

module.exports = { getImportDefinition, availableEntities: Object.keys(parsers) };
