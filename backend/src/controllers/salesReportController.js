const { previewSalesReportImport, commitSalesReportImport } = require('../services/salesReportImport/salesReportImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function salesReportImportPreview(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await previewSalesReportImport(req.file.buffer);
  return success(res, result, 'Preview generated');
}

async function salesReportImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await commitSalesReportImport(req.file.buffer, req.user.id);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'SALES_REPORT', ...result } });
  return success(res, result, 'Sales report data imported');
}

module.exports = { salesReportImportPreview, salesReportImport };
