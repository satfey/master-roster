const { importEmployees, importStores } = require('../services/importService');
const { previewSalesImport, commitSalesImport } = require('../services/salesImport/salesImportService');
const { importGeneric } = require('../services/genericImport/genericImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function salesImportPreview(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await previewSalesImport(req.file.buffer);
  return success(res, result, 'Preview generated');
}

async function salesImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await commitSalesImport(req.file.buffer);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'SALES', ...result } });
  return success(res, result, 'Sales data imported');
}

async function employeeImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await importEmployees(req.file.buffer);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'EMPLOYEE', ...result } });
  return success(res, result, 'Employee data imported');
}

async function storeImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await importStores(req.file.buffer);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'STORE', ...result } });
  return success(res, result, 'Store data imported');
}

/**
 * Generic bulk importer: POST /api/import, form-data { file, entity }.
 * `entity` selects which registered table to import into (see
 * services/genericImport/importRegistry.js) — e.g. employee, store, laborGuideline.
 */
async function genericImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);

  const { entity } = req.body;
  if (!entity) return failure(res, 'Missing required field "entity" (e.g. employee, store, laborGuideline)', 400);

  const result = await importGeneric(entity, req.file.buffer);

  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { entity, ...result } });

  // Matches the exact { success, total, inserted, failed } contract requested for
  // this endpoint, so it intentionally bypasses the success()/failure() wrapper.
  return res.status(result.success ? 201 : 422).json(result);
}

module.exports = { salesImportPreview, salesImport, employeeImport, storeImport, genericImport };
