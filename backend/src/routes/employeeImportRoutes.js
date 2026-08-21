const router = require('express').Router();
const employeeImportController = require('../controllers/employeeImportController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /employee/import/preview:
 *   post:
 *     summary: Parse and validate an Employee Master Excel file without importing it
 *     description: >
 *       The real file may have hundreds of columns in any order — only 20
 *       are read (matched by exact header name, not position; everything
 *       else is ignored): Employee ID, Legal Name - Title/First Name/Last
 *       Name, First/Last Name - Local, Email - Primary Home, Position
 *       Title, Position Time Type, Location, Default Weekly Hours, Pay Rate
 *       Type, and the SL/HR Comp Plan/Amount/Currency/Frequency columns.
 *       employee.id (VARCHAR, never a generated UUID) IS the Employee ID
 *       itself — preserved as a string exactly as given, including leading
 *       zeros. Location is matched against an
 *       existing store (by store.id or store.name); it is never interpreted
 *       as a UUID, and an unresolved or blank Location makes the row
 *       invalid rather than guessing a store, since employee.store_id is
 *       required. A repeated Employee ID within the same file invalidates
 *       every row that shares it. Preview never writes to the database.
 *     tags: [Employee]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Row-by-row validation preview — nothing is written to the database.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         totalRows: { type: integer }
 *                         validRows: { type: integer }
 *                         invalidRows: { type: integer }
 *                         newEmployeeCount: { type: integer }
 *                         updateEmployeeCount: { type: integer }
 *                         unchangedEmployeeCount: { type: integer }
 *                         rows:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               status: { type: string, enum: [valid, invalid] }
 *                               errors: { type: array, items: { type: string } }
 *                               employeeId: { type: string, nullable: true, example: '000123' }
 *                               firstName: { type: string, nullable: true }
 *                               lastName: { type: string, nullable: true }
 *                               location: { type: string, nullable: true, example: 'DQ1005-CENTER ONE' }
 *                               resolvedStoreId: { type: string, nullable: true, example: '1005', description: 'store.id — not a UUID.' }
 *                               action: { type: string, nullable: true, enum: [CREATE, UPDATE, NO_CHANGE] }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 totalRows: 1
 *                 validRows: 1
 *                 invalidRows: 0
 *                 newEmployeeCount: 1
 *                 updateEmployeeCount: 0
 *                 unchangedEmployeeCount: 0
 *                 rows:
 *                   - rowNumber: 2
 *                     status: valid
 *                     errors: []
 *                     employeeId: '000123'
 *                     firstName: Somchai
 *                     lastName: Jaidee
 *                     location: DQ1005-CENTER ONE
 *                     resolvedStoreId: '1005'
 *                     action: CREATE
 *       400:
 *         description: No file was uploaded, or no worksheet/header row could be found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /employee/import:
 *   post:
 *     summary: Bulk import an Employee Master Excel file (create/update employees)
 *     description: >
 *       employee.id is the identity: an unseen Employee ID creates a new
 *       employee, an existing one updates it (no duplicate rows), and a row
 *       that would change nothing is reported as unchanged and not written.
 *       Re-importing the same file is idempotent.
 *     tags: [Employee]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Import result summary.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         total: { type: integer }
 *                         created: { type: integer }
 *                         updated: { type: integer }
 *                         unchanged: { type: integer }
 *                         failed:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               employeeId: { type: string, nullable: true }
 *                               errors: { type: array, items: { type: string } }
 *             example:
 *               success: true
 *               message: Employee data imported
 *               data:
 *                 total: 1
 *                 created: 1
 *                 updated: 0
 *                 unchanged: 0
 *                 failed: []
 *       400:
 *         description: No file was uploaded, or no worksheet/header row could be found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/import/preview', authenticate, authorize('employee:import'), upload.single('file'), employeeImportController.employeeImportPreview);
router.post('/import', authenticate, authorize('employee:import'), upload.single('file'), employeeImportController.employeeImport);

module.exports = router;
