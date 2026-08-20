const { parseNumber, parseDate: parseDateBase, normalizeStoreId } = require('../salesImport/transform');

const MONTH_ABBREVIATIONS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Extends the shared parseDate with this report's "Wed, 01-Jul-2026" day-labeled format; falls back to the shared parser (Date objects, Excel serials, dd/mm/yyyy, generic strings) for everything else so existing format support isn't lost. */
function parseReportDate(value) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^[A-Za-z]{3,},?\s+(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
    if (match) {
      const [, dayStr, monthStr, yearStr] = match;
      const month = MONTH_ABBREVIATIONS[monthStr.slice(0, 3).toLowerCase()];
      if (month !== undefined) {
        const dt = new Date(Date.UTC(Number(yearStr), month, Number(dayStr)));
        if (!Number.isNaN(dt.getTime())) return dt;
      }
    }
  }
  return parseDateBase(value);
}

/** parseNumber always yields a float-capable number; round explicitly for INTEGER columns rather than relying on Postgres's implicit numeric->integer cast. */
function toInt(value) {
  const num = parseNumber(value);
  return num === null ? null : Math.round(num);
}

function toTrimmedStringOrNull(value) {
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function transformRow(raw) {
  const errors = [];

  const storeBuId = toInt(raw.storeBuId);
  if (storeBuId === null) errors.push('Missing Store BU Id (column A)');

  const reportStoreId = toInt(raw.reportStoreId);
  if (reportStoreId === null) errors.push('Missing or invalid Store ID (column B)');

  // String-preserving form of the same column, used as store.id (the
  // canonical DB primary key) — reportStoreId stays an integer for the
  // report_store_id column/API field, unaffected.
  const storeId = normalizeStoreId(raw.reportStoreId);

  let reportDate = null;
  if (raw.reportDate === null || raw.reportDate === undefined || raw.reportDate === '') {
    errors.push('Missing Date (column E)');
  } else {
    reportDate = parseReportDate(raw.reportDate);
    if (!reportDate) errors.push('Invalid Date (column E)');
  }

  return {
    rowNumber: raw.rowNumber,
    storeBuId,
    reportStoreId,
    storeId,
    storeName: toTrimmedStringOrNull(raw.storeName),
    week: toTrimmedStringOrNull(raw.week), // e.g. "2026-27" — not numeric, preserved as-is
    reportDate,

    grossActual: parseNumber(raw.grossActual),
    grossBudget: parseNumber(raw.grossBudget),
    grossVariancePercent: parseNumber(raw.grossVariancePercent),
    grossActualLy: parseNumber(raw.grossActualLy),
    grossLyVariancePercent: parseNumber(raw.grossLyVariancePercent),
    grossActualMtd: parseNumber(raw.grossActualMtd),
    grossBudgetMtd: parseNumber(raw.grossBudgetMtd),
    grossMtdVariancePercent: parseNumber(raw.grossMtdVariancePercent),
    grossActualLyMtd: parseNumber(raw.grossActualLyMtd),

    docketActual: toInt(raw.docketActual),
    docketBudget: toInt(raw.docketBudget),
    docketVariancePercent: parseNumber(raw.docketVariancePercent),
    docketActualLy: toInt(raw.docketActualLy),
    docketLyVariancePercent: parseNumber(raw.docketLyVariancePercent),

    customerActual: toInt(raw.customerActual),
    customerBudget: toInt(raw.customerBudget),
    customerVariancePercent: parseNumber(raw.customerVariancePercent),
    customerActualLy: toInt(raw.customerActualLy),
    customerLyVariancePercent: parseNumber(raw.customerLyVariancePercent),

    otherSales: parseNumber(raw.otherSales),
    serviceCharge: parseNumber(raw.serviceCharge),

    errors,
  };
}

function transformRows(rawRows) {
  return rawRows.map(transformRow);
}

module.exports = { transformRows };
