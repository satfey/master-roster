const { previewSalesByHourImport, commitSalesByHourImport } = require('../services/salesByHourImport/salesByHourImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

/** This report has no date column at all (confirmed with the report owner — it's an hour-of-day breakdown aggregated across a whole month), so the month can't be parsed from the file. The caller must supply it. Accepts "YYYY-MM" or "YYYY-MM-DD"; normalizes to the 1st of that month. */
function parseMonthParam(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return null;
  const [, year, month] = match;
  if (Number(month) < 1 || Number(month) > 12) return null;
  return `${year}-${month}-01`;
}

async function salesByHourImportPreview(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const reportMonth = parseMonthParam(req.body.month);
  if (!reportMonth) return failure(res, 'Missing or invalid required field "month" (e.g. 2026-07 or 2026-07-01) — this report has no date column, so the month must be provided', 400);

  const result = await previewSalesByHourImport(req.file.buffer, reportMonth);
  return success(res, result, 'Preview generated');
}

async function salesByHourImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const reportMonth = parseMonthParam(req.body.month);
  if (!reportMonth) return failure(res, 'Missing or invalid required field "month" (e.g. 2026-07 or 2026-07-01) — this report has no date column, so the month must be provided', 400);

  const result = await commitSalesByHourImport(req.file.buffer, reportMonth, req.user.id);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'SALES_BY_HOUR', month: reportMonth, ...result } });
  return success(res, result, 'Sales by hour data imported');
}

module.exports = { salesByHourImportPreview, salesByHourImport };
