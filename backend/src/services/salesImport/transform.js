const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** Coerces currency ("฿1,234.50"), accounting-negative ("(1,234.50)"), and percent ("12.5%") text into a plain number. */
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return null;

  let str = String(value).trim();
  if (str === '') return null;

  const isNegative = /^\(.*\)$/.test(str);
  if (isNegative) str = str.slice(1, -1);
  const isPercent = /%\s*$/.test(str);

  str = str.replace(/[^0-9.\-]/g, '');
  if (str === '' || str === '-' || str === '.') return null;

  let num = Number(str);
  if (Number.isNaN(num)) return null;
  if (isNegative) num = -Math.abs(num);
  if (isPercent) num = num / 100;
  return num;
}

/** Handles Excel serial dates, JS Date cells, and common text date formats. */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    return new Date(EXCEL_EPOCH_UTC + Math.round(value * 86400000));
  }

  const str = String(value).trim();
  if (str === '') return null;

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, yRaw] = dmy;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Preserves a source-file entity ID exactly as given, for use as a database
 * primary key. A numeric Excel cell (e.g. 1001) becomes its plain integer
 * text; a text cell (e.g. "001001") is kept verbatim — never round-tripped
 * through Number(), which would strip leading zeros. Shared by every
 * importer that adopts the source ID as the canonical store.id (Sales
 * Report, Sales By Hour, Store Master) — NOT used by this file's own
 * transformRow, which keeps its original storeCode-matching behavior.
 */
function normalizeStoreId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : null;
  }
  const str = String(value).trim();
  return str === '' ? null : str;
}

/** Converts one raw parsed Excel row into a structured sales row + validation errors. */
function transformRow(raw) {
  const errors = [];

  const storeCode = raw.storeCode === null || raw.storeCode === undefined ? '' : String(raw.storeCode).trim();
  if (!storeCode) errors.push('Missing store code');

  let salesDate = null;
  if (raw.salesDate === null || raw.salesDate === undefined || raw.salesDate === '') {
    errors.push('Missing sales date');
  } else {
    salesDate = parseDate(raw.salesDate);
    if (!salesDate) errors.push('Invalid sales date');
  }

  let salesAmount = null;
  if (raw.salesAmount === null || raw.salesAmount === undefined || raw.salesAmount === '') {
    errors.push('Missing sales amount');
  } else {
    salesAmount = parseNumber(raw.salesAmount);
    if (salesAmount === null) errors.push('Invalid sales amount');
  }

  return {
    rowNumber: raw.rowNumber,
    storeCode: storeCode || null,
    salesDate,
    salesAmount,
    docket: parseNumber(raw.docket),
    labourHours: parseNumber(raw.labourHours),
    errors,
  };
}

function transformRows(rawRows) {
  return rawRows.map(transformRow);
}

module.exports = { transformRows, parseNumber, parseDate, normalizeStoreId };
