const { parseNumber } = require('../salesImport/transform');

/** parseNumber returns null for Date objects — but if the "Hour" column happens to be time-formatted in Excel (e.g. 09:00), exceljs resolves it to a Date. Extract the hour component instead of rejecting it. */
function parseHour(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getUTCHours();
  }
  const num = parseNumber(value);
  return num === null ? null : Math.round(num);
}

function toTrimmedStringOrNull(value) {
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function transformRow(raw) {
  const errors = [];

  const reportStoreId = (() => {
    const num = parseNumber(raw.reportStoreId);
    return num === null ? null : Math.round(num);
  })();
  if (reportStoreId === null) errors.push('Missing Store Id');

  const storeName = toTrimmedStringOrNull(raw.storeName);
  if (storeName === null) errors.push('Missing Store Name');

  const grossSale = parseNumber(raw.grossSale);
  if (grossSale === null) errors.push('Invalid Gross Sale');

  const hour = parseHour(raw.hour);
  if (hour === null) errors.push('Invalid Hour');

  return {
    rowNumber: raw.rowNumber,
    brandName: toTrimmedStringOrNull(raw.brandName),
    reportStoreId,
    storeName,
    grossSale,
    hour,
    errors,
  };
}

function transformRows(rawRows) {
  return rawRows.map(transformRow);
}

module.exports = { transformRows };
