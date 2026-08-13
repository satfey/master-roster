const router = require('express').Router();
const salesReportController = require('../controllers/salesReportController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /sales/report/import/preview:
 *   post:
 *     summary: Parse and validate a fixed-layout sales report Excel file without importing it
 *     description: >
 *       Expects a .xlsx file with a fixed 26-column layout (A-Z) — Store BU ID,
 *       Store ID, Store Name, Week, Date, then Gross/Docket/Customer
 *       actual/budget/variance/LY/MTD figures, Other Sales, and Service Charge.
 *       The header row is detected by content (not a fixed row number), since
 *       report/KPI sections above the table vary in length. Store BU ID,
 *       Store ID, Store Name, and Week repeat only on the first day of each
 *       Store/Week block (merged cells) and are carried forward across
 *       subsequent daily rows. Store/Week Total rows are detected and
 *       skipped automatically. A Store ID with no matching store.storeCode is
 *       NOT invalid — it is flagged via `willCreateStore: true` here, and the
 *       store is auto-created on commit (see /sales/report/import).
 *     tags: [Sales Report]
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
 *                         duplicateRows: { type: integer }
 *                         newStoreCount: { type: integer, description: 'Number of distinct Store IDs with no matching store.storeCode — these will be auto-created on commit, not treated as errors.' }
 *                         rows:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/SalesReport'
 *                               - type: object
 *                                 properties:
 *                                   rowNumber: { type: integer }
 *                                   status: { type: string, enum: [valid, invalid, duplicate] }
 *                                   errors: { type: array, items: { type: string } }
 *                                   willCreateStore: { type: boolean, description: 'True if this row''s Store ID has no matching store yet and would be auto-created on commit.' }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 totalRows: 2
 *                 validRows: 2
 *                 invalidRows: 0
 *                 duplicateRows: 0
 *                 newStoreCount: 1
 *                 rows:
 *                   - rowNumber: 2
 *                     status: valid
 *                     errors: []
 *                     willCreateStore: false
 *                     reportStoreId: 1001
 *                     storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     storeBuId: 5
 *                     storeName: Bangna Store
 *                     week: '2026-27'
 *                     reportDate: '2026-08-03'
 *                     grossActual: 10000
 *                     grossBudget: 9500
 *                     grossVariancePercent: 0.05
 *                   - rowNumber: 3
 *                     status: valid
 *                     errors: []
 *                     willCreateStore: true
 *                     reportStoreId: 2002
 *                     storeId: null
 *                     storeBuId: 6
 *                     storeName: New Store B
 *                     week: '2026-27'
 *                     reportDate: '2026-08-03'
 *                     grossActual: 8000
 *                     grossBudget: 7500
 *                     grossVariancePercent: 0.02
 *       400:
 *         description: No file was uploaded.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'No file uploaded', errors: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /sales/report/import:
 *   post:
 *     summary: Bulk import a fixed-layout sales report via Excel (.xlsx)
 *     description: >
 *       Only rows that pass validation and aren't duplicates are inserted into
 *       sales_report; the response reports what happened to every row. Store
 *       IDs with no matching store.storeCode are auto-created (one store per
 *       distinct Store ID, even if it appears on many rows) before the sales
 *       report rows are inserted — see `storesCreated` in the response.
 *     tags: [Sales Report]
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
 *         description: Import result (200, not 201 — the response wraps a summary object rather than the created records).
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
 *                         imported: { type: integer }
 *                         skippedDuplicates: { type: integer }
 *                         storesCreated:
 *                           type: array
 *                           description: Stores auto-created during this commit because their Store ID had no matching store.storeCode.
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               storeCode: { type: string, example: '2002' }
 *                               name: { type: string, nullable: true, example: 'New Store B' }
 *                         failed:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               reportStoreId: { type: integer, nullable: true }
 *                               errors: { type: array, items: { type: string } }
 *             example:
 *               success: true
 *               message: Sales report data imported
 *               data:
 *                 total: 10
 *                 imported: 9
 *                 skippedDuplicates: 0
 *                 storesCreated:
 *                   - id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb999
 *                     storeCode: '2002'
 *                     name: New Store B
 *                 failed:
 *                   - rowNumber: 5
 *                     reportStoreId: 1001
 *                     errors: ['Missing Date (column E)']
 *       400:
 *         description: No file was uploaded.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'No file uploaded', errors: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/import/preview', authenticate, authorize('sales:import'), upload.single('file'), salesReportController.salesReportImportPreview);
router.post('/import', authenticate, authorize('sales:import'), upload.single('file'), salesReportController.salesReportImport);

module.exports = router;
