const { parseNumber, normalizeStoreId } = require('../salesImport/transform');

function toTrimmedStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

function transformRow(raw) {
  const errors = [];

  // Same string-preserving parsing already used for Store IDs — leading
  // zeros ("000123") must survive exactly, never round-tripped through
  // Number().
  const employeeId = normalizeStoreId(raw.employeeId);
  if (employeeId === null) errors.push('Missing Employee ID');

  return {
    rowNumber: raw.rowNumber,
    employeeId,
    title: toTrimmedStringOrNull(raw.title),
    firstName: toTrimmedStringOrNull(raw.firstName),
    lastName: toTrimmedStringOrNull(raw.lastName),
    firstNameLocal: toTrimmedStringOrNull(raw.firstNameLocal),
    lastNameLocal: toTrimmedStringOrNull(raw.lastNameLocal),
    email: toTrimmedStringOrNull(raw.email),
    position: toTrimmedStringOrNull(raw.position),
    positionTimeType: toTrimmedStringOrNull(raw.positionTimeType),
    storeName: toTrimmedStringOrNull(raw.storeName), // "Location" — plain text, never interpreted as an id here
    defaultWeeklyHours: parseNumber(raw.defaultWeeklyHours),
    payRateType: toTrimmedStringOrNull(raw.payRateType),
    slCompPlan: toTrimmedStringOrNull(raw.slCompPlan),
    slCompAmount: parseNumber(raw.slCompAmount),
    slCompCurrency: toTrimmedStringOrNull(raw.slCompCurrency),
    slCompFrequency: toTrimmedStringOrNull(raw.slCompFrequency),
    hrCompPlan: toTrimmedStringOrNull(raw.hrCompPlan),
    hrCompAmount: parseNumber(raw.hrCompAmount),
    hrCompCurrency: toTrimmedStringOrNull(raw.hrCompCurrency),
    hrCompFrequency: toTrimmedStringOrNull(raw.hrCompFrequency),
    errors,
  };
}

function transformRows(rawRows) {
  return rawRows.map(transformRow);
}

module.exports = { transformRows };
