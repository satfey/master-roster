const { previewWhrTargetImport, commitWhrTargetImport } = require('../services/whrTargetImport/whrTargetImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function whrTargetImportPreview(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await previewWhrTargetImport(req.file.buffer);
  return success(res, result, 'Preview generated');
}

async function whrTargetImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await commitWhrTargetImport(req.file.buffer, req.user.id);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'WHR_TARGET', ...result } });
  return success(res, result, 'WHR Target data imported');
}

module.exports = { whrTargetImportPreview, whrTargetImport };
