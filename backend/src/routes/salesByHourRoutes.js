const router = require('express').Router();
const salesByHourController = require('../controllers/salesByHourController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /sales/by-hour/import/preview:
 *   post:
 *     summary: Parse and validate a Sales by Hour Excel file without importing it
 *     description: >
 *       Expects a .xlsx file with a fixed 5-column layout (A-E) — Brand Name,
 *       Store Id, Store Name, Gross Sale, Hour. The header row is detected by
 *       content (not a fixed row number), since a title/preamble section
 *       above the table varies in length. Brand Name, Store Id, and Store
 *       Name repeat only on the first hour-row of each Store block (merged
 *       cells) and are carried forward across subsequent rows.
 *       This report has NO date column — each Gross Sale figure is an
 *       hour-of-day total aggregated across an entire month, not a single
 *       day. Because of that, the month can't be read from the file; it must
 *       be supplied via the required "month" form field (e.g. "2026-07").
 *       A Store Id with no matching store.storeCode is NOT invalid — it is
 *       flagged via `willCreateStore: true` here, and the store is
 *       auto-created on commit (see /sales/by-hour/import).
 *     tags: [Sales By Hour]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, month]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               month:
 *                 type: string
 *                 example: '2026-07'
 *                 description: The month this file's hourly figures cover — not present in the Excel itself.
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
 *                         newStoreCount: { type: integer, description: 'Number of distinct Store IDs with no matching store.storeCode — auto-created on commit, not treated as errors.' }
 *                         rows:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/SalesByHour'
 *                               - type: object
 *                                 properties:
 *                                   rowNumber: { type: integer }
 *                                   status: { type: string, enum: [valid, invalid, duplicate] }
 *                                   errors: { type: array, items: { type: string } }
 *                                   willCreateStore: { type: boolean }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 totalRows: 2
 *                 validRows: 2
 *                 invalidRows: 0
 *                 duplicateRows: 0
 *                 newStoreCount: 0
 *                 rows:
 *                   - rowNumber: 4
 *                     status: valid
 *                     errors: []
 *                     willCreateStore: false
 *                     reportStoreId: 1001
 *                     storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     brandName: ABC
 *                     storeName: ABC Central
 *                     reportMonth: '2026-07-01'
 *                     hour: 1
 *                     grossSale: 1150
 *                   - rowNumber: 5
 *                     status: valid
 *                     errors: []
 *                     willCreateStore: false
 *                     reportStoreId: 1001
 *                     storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     brandName: ABC
 *                     storeName: ABC Central
 *                     reportMonth: '2026-07-01'
 *                     hour: 9
 *                     grossSale: 1280
 *       400:
 *         description: No file was uploaded, or "month" is missing/malformed.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'Missing or invalid required field "month" (e.g. 2026-07 or 2026-07-01) — this report has no date column, so the month must be provided', errors: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /sales/by-hour/import:
 *   post:
 *     summary: Bulk import a Sales by Hour Excel file
 *     description: >
 *       Only rows that pass validation and aren't duplicates are inserted
 *       into sales_by_hour; the response reports what happened to every row.
 *       Store IDs with no matching store.storeCode are auto-created (one
 *       store per distinct Store ID, even if it appears on many rows) before
 *       the sales-by-hour rows are inserted — see `storesCreated` in the
 *       response. Duplicate detection is by (store, month, hour) — importing
 *       the same file for the same month twice will not double-insert.
 *     tags: [Sales By Hour]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, month]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               month:
 *                 type: string
 *                 example: '2026-07'
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
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, format: uuid }
 *                               storeCode: { type: string, example: '1001' }
 *                               name: { type: string, nullable: true, example: 'ABC Central' }
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
 *               message: Sales by hour data imported
 *               data:
 *                 total: 24
 *                 imported: 23
 *                 skippedDuplicates: 0
 *                 storesCreated:
 *                   - id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb999
 *                     storeCode: '1001'
 *                     name: ABC Central
 *                 failed:
 *                   - rowNumber: 30
 *                     reportStoreId: 1001
 *                     errors: ['Invalid Hour']
 *       400:
 *         description: No file was uploaded, or "month" is missing/malformed.
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
router.post('/import/preview', authenticate, authorize('sales:import'), upload.single('file'), salesByHourController.salesByHourImportPreview);
router.post('/import', authenticate, authorize('sales:import'), upload.single('file'), salesByHourController.salesByHourImport);

module.exports = router;
