const { previewSalesReportImport, commitSalesReportImport } = require('../services/salesReportImport/salesReportImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

const LOG_PREFIX = '[SALES_REPORT_PREVIEW]';

async function salesReportImportPreview(req, res) {
  const tRequestStart = Date.now();
  console.log(`${LOG_PREFIX} request start`);
  if (!req.file) return failure(res, 'No file uploaded', 400);
  console.log(`${LOG_PREFIX} file received: ${req.file.originalname} (${req.file.buffer.length} bytes)`);

  const result = await previewSalesReportImport(req.file.buffer);

  // Stringify explicitly (once) so serialization time and the exact response
  // byte size are both measurable — res.json() would otherwise do this same
  // work invisibly. Same envelope success() always sends, just measured.
  const tSerializeStart = Date.now();
  const body = JSON.stringify({ success: true, message: 'Preview generated', data: result });
  const tSerializeEnd = Date.now();
  console.log(`${LOG_PREFIX} JSON serialization: ${tSerializeEnd - tSerializeStart} ms (${body.length} bytes)`);
  console.log(`${LOG_PREFIX} total (request start to response ready): ${tSerializeEnd - tRequestStart} ms`);

  res.status(200).type('application/json').send(body);
}

async function salesReportImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await commitSalesReportImport(req.file.buffer, req.user.id);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'SALES_REPORT', ...result } });
  return success(res, result, 'Sales report data imported');
}

module.exports = { salesReportImportPreview, salesReportImport };
