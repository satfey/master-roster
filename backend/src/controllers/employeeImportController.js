const { previewEmployeeImport, commitEmployeeImport } = require('../services/employeeImport/employeeImportService');
const { success, failure } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

async function employeeImportPreview(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await previewEmployeeImport(req.file.buffer);
  return success(res, result, 'Preview generated');
}

async function employeeImport(req, res) {
  if (!req.file) return failure(res, 'No file uploaded', 400);
  const result = await commitEmployeeImport(req.file.buffer);
  await logActivity({ userId: req.user.id, action: 'IMPORT_EXCEL', details: { type: 'EMPLOYEE_MASTER', ...result } });
  return success(res, result, 'Employee data imported');
}

module.exports = { employeeImportPreview, employeeImport };
