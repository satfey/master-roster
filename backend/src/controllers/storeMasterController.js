const { previewStoreMasterImport, commitStoreMasterImport } = require('../services/storeMasterImport/storeMasterImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function storeMasterImportPreview(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await previewStoreMasterImport(req.file.buffer);
  return success(res, result, 'Preview generated');
}

async function storeMasterImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await commitStoreMasterImport(req.file.buffer);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'STORE_MASTER', ...result } });
  return success(res, result, 'Store master data imported');
}

module.exports = { storeMasterImportPreview, storeMasterImport };
