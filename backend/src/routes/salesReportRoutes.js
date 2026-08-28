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
 *
 *       A (store_id, report_date) that already exists in sales_report is NOT
 *       a rejected duplicate — the newly uploaded file is the source of
 *       truth, so that row is flagged `status: update` here and will
 *       overwrite the existing row on commit (see /sales/report/import). Only
 *       a repeat of the same (store_id, report_date) *within this same file*
 *       is a real in-file duplicate (`status: duplicate_in_file`) — the last
 *       occurrence in the file wins and is written; earlier ones are not.
 *       The `previewRows` array is capped (200 rows) and always prioritizes
 *       invalid and duplicate_in_file rows so problems are never hidden by
 *       the cap — use the summary counts (`totalRows`, `newRows`,
 *       `updateRows`, etc.) for totals, not `previewRows.length`.
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
 *                         newRows: { type: integer, description: 'Rows with no existing (store_id, report_date) — will be INSERTed.' }
 *                         updateRows: { type: integer, description: 'Rows whose (store_id, report_date) already exists — will be UPDATEd with this file''s data.' }
 *                         validRows: { type: integer, description: 'newRows + updateRows — total rows that will actually be written.' }
 *                         invalidRows: { type: integer }
 *                         duplicateInFileRows: { type: integer, description: 'Rows sharing a (store_id, report_date) with a later row in this same file — only the last occurrence is written.' }
 *                         newStoreCount: { type: integer, description: 'Number of distinct Store IDs with no matching store.storeCode — these will be auto-created on commit, not treated as errors.' }
 *                         previewRowCount: { type: integer, description: 'How many rows are actually included in previewRows below (capped at 200, invalid/duplicate_in_file rows always included first).' }
 *                         previewRows:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/SalesReport'
 *                               - type: object
 *                                 properties:
 *                                   rowNumber: { type: integer }
 *                                   status: { type: string, enum: [new, update, invalid, duplicate_in_file] }
 *                                   errors: { type: array, items: { type: string } }
 *                                   storeId: { type: string, nullable: true, example: '1001', description: 'The canonical Store ID — this IS store.id (same value as reportStoreId, as a string), not a UUID.' }
 *                                   willCreateStore: { type: boolean, description: 'True if this row''s Store ID has no matching store yet and would be auto-created on commit.' }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 totalRows: 2
 *                 newRows: 1
 *                 updateRows: 1
 *                 validRows: 2
 *                 invalidRows: 0
 *                 duplicateInFileRows: 0
 *                 newStoreCount: 1
 *                 previewRowCount: 2
 *                 previewRows:
 *                   - rowNumber: 2
 *                     status: update
 *                     errors: []
 *                     willCreateStore: false
 *                     reportStoreId: 1001
 *                     storeId: '1001'
 *                     storeBuId: 5
 *                     storeName: Bangna Store
 *                     week: '2026-27'
 *                     reportDate: '2026-08-03'
 *                     grossActual: 10000
 *                     grossBudget: 9500
 *                     grossVariancePercent: 0.05
 *                   - rowNumber: 3
 *                     status: new
 *                     errors: []
 *                     willCreateStore: true
 *                     reportStoreId: 2002
 *                     storeId: '2002'
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
 *       Every row that passes validation is written via an atomic upsert on
 *       the (store_id, report_date) unique constraint: a key not already in
 *       sales_report is inserted, a key that already exists is overwritten
 *       in place with this file's data (the newly uploaded file is the
 *       source of truth — this is never rejected as a duplicate, and never
 *       raises a unique-violation). A (store_id, report_date) repeated more
 *       than once within this same file is resolved deterministically before
 *       writing — the last occurrence in the file wins; earlier ones are
 *       skipped (see `skippedDuplicatesInFile`). Only rows that fail
 *       validation are excluded (see `failed`). Store IDs with no matching
 *       existing store are auto-created — the Excel Store ID becomes
 *       store.id directly (one store per distinct Store ID, even if it
 *       appears on many rows) before the sales report rows are written —
 *       see `storesCreated` in the response.
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
 *                         imported: { type: integer, description: 'Rows written this commit, insert + update combined.' }
 *                         inserted: { type: integer, description: '(store_id, report_date) not previously in sales_report.' }
 *                         updated: { type: integer, description: '(store_id, report_date) already existed and was overwritten with this file''s data.' }
 *                         skippedDuplicatesInFile: { type: integer, description: 'Rows sharing a (store_id, report_date) with a later row in this same file — not written, the later row was used instead.' }
 *                         storesCreated:
 *                           type: array
 *                           description: Stores auto-created during this commit because their Store ID had no matching existing store.
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, example: '2002', description: 'The canonical Store ID, taken directly from the Excel file — not a UUID.' }
 *                               storeId: { type: string, example: '2002', description: 'Alias for id.' }
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
 *                 inserted: 6
 *                 updated: 3
 *                 skippedDuplicatesInFile: 0
 *                 storesCreated:
 *                   - id: '2002'
 *                     storeId: '2002'
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
