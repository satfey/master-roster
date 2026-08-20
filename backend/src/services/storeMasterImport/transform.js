const { parseDate, normalizeStoreId } = require('../salesImport/transform');

function toTrimmedStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

/** Collapses leading/trailing and repeated whitespace and case, so "John Smith", " John Smith ", "JOHN  SMITH" all match the same Area Coach. */
function normalizeName(value) {
  const trimmed = toTrimmedStringOrNull(value);
  return trimmed === null ? null : trimmed.toLowerCase().replace(/\s+/g, ' ');
}

function transformRow(raw) {
  const errors = [];

  const storeCode = normalizeStoreId(raw.id);
  if (storeCode === null) errors.push('Missing ID');

  const branch = toTrimmedStringOrNull(raw.branch);
  if (branch === null) errors.push('Missing Branch');

  // Blank Zone Update means "no Area Coach" (allow area_coach_id = NULL),
  // not an error — there is no business rule requiring every store to have
  // one, and inventing one is out of scope.
  const areaCoachName = toTrimmedStringOrNull(raw.zoneUpdate);
  const areaCoachNameNormalized = normalizeName(raw.zoneUpdate);

  return {
    rowNumber: raw.rowNumber,
    storeCode,
    branch,
    areaCoachName,
    areaCoachNameNormalized,
    effectiveDate: parseDate(raw.effectiveDate), // informational only — never persisted, never blocks validation
    effectiveDateRaw: raw.effectiveDate,
    errors,
  };
}

function transformRows(rawRows) {
  return rawRows.map(transformRow);
}

module.exports = { transformRows, normalizeStoreId, normalizeName };
