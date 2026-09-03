const { parseNumber, normalizeStoreId } = require('../salesImport/transform');

// COG (Cost of Goods) must never exceed this share of Sales — a fixed
// business rule, not a per-store/per-file configurable target.
const COG_LIMIT_PERCENT = 0.33;

// "1001 Store Name ABC" -> id "1001" (informational only, store_id always
// comes from the file's own dedicated CODE column, never from this) + name
// "Store Name ABC". No identical splitter exists elsewhere in this codebase
// (checked storeMasterImport/employeeImport/salesImport) — the closest
// precedent, employeeImportService's extractStoreIdFromLocationPrefix, only
// extracts the id and discards the rest, so this is new but follows the same
// "a name-like column can't be trusted to be name-only" reasoning.
const LEADING_STORE_ID_PATTERN = /^(\d+)\s+(.+)$/;

function splitLeadingStoreIdFromName(rawName) {
  if (rawName === null || rawName === undefined) return { embeddedStoreId: null, storeName: null };
  const trimmed = String(rawName).trim();
  if (trimmed === '') return { embeddedStoreId: null, storeName: null };
  const match = trimmed.match(LEADING_STORE_ID_PATTERN);
  if (!match) return { embeddedStoreId: null, storeName: trimmed };
  return { embeddedStoreId: match[1], storeName: match[2].trim() || null };
}

/**
 * COG% = COG / Sales, never computed by dividing by zero. Sales missing or
 * 0 with a nonzero COG is reported as an explicit error (a real data
 * problem — money spent on goods against no sales), not silently skipped or
 * treated as 0%/Infinity%. Sales 0 and COG 0/absent together is not an
 * error (nothing to validate — e.g. a closed store that month).
 */
function computeCogValidation(cog, monthlySales) {
  const errors = [];
  if (cog === null) return { cogPercent: null, errors };

  if (monthlySales === null) {
    errors.push('Cannot calculate COG% — SALES is missing');
    return { cogPercent: null, errors };
  }
  if (monthlySales === 0) {
    if (cog !== 0) errors.push(`Cannot calculate COG% — SALES is 0 but COG is ${cog} (division by zero avoided)`);
    return { cogPercent: null, errors };
  }

  const cogPercent = Math.round((cog / monthlySales) * 10000) / 10000;
  if (cogPercent > COG_LIMIT_PERCENT) {
    errors.push(`COG ${(cogPercent * 100).toFixed(1)}% exceeds the 33% limit (COG ${cog} / Sales ${monthlySales})`);
  }
  return { cogPercent, errors };
}

function transformRow(raw, reportMonth) {
  const errors = [];

  const storeId = normalizeStoreId(raw.storeCode);
  if (storeId === null) errors.push('Missing CODE (column B)');
  const reportStoreId = parseNumber(raw.storeCode);

  const { storeName } = splitLeadingStoreIdFromName(raw.storeNameRaw);

  const monthlySales = parseNumber(raw.monthlySales);
  const whrs = parseNumber(raw.whrs);
  const productivity = parseNumber(raw.productivity);
  const cog = parseNumber(raw.cog);

  const { cogPercent, errors: cogErrors } = computeCogValidation(cog, monthlySales);
  errors.push(...cogErrors);

  return {
    rowNumber: raw.rowNumber,
    storeId,
    reportStoreId,
    storeName,
    reportMonth,
    monthlySales,
    whrs,
    productivity,
    cog,
    cogPercent,
    errors,
  };
}

function transformRows(rawRows, reportMonth) {
  return rawRows.map((raw) => transformRow(raw, reportMonth));
}

module.exports = { transformRows, transformRow, splitLeadingStoreIdFromName, computeCogValidation, COG_LIMIT_PERCENT };
