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
 *       A Store Id with no matching existing store is NOT invalid — it is
 *       flagged via `willCreateStore: true` here, and the store is
 *       auto-created on commit (see /sales/by-hour/import) using the Excel
 *       Store ID directly as store.id.
 *
 *       A (store_id, report_month, hour) that already exists in
 *       sales_by_hour is NOT a rejected duplicate — the newly uploaded file
 *       is the source of truth, so that row is flagged `status: update` here
 *       and will overwrite the existing row on commit (see
 *       /sales/by-hour/import). Only a repeat of the same (store_id,
 *       report_month, hour) *within this same file* is a real in-file
 *       duplicate (`status: duplicate_in_file`) — the last occurrence in the
 *       file wins and is written; earlier ones are not.
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
 *                         newRows: { type: integer, description: 'Rows with no existing (store_id, report_month, hour) — will be INSERTed.' }
 *                         updateRows: { type: integer, description: 'Rows whose (store_id, report_month, hour) already exists — will be UPDATEd with this file''s data.' }
 *                         validRows: { type: integer, description: 'newRows + updateRows — total rows that will actually be written, insert + update combined.' }
 *                         invalidRows: { type: integer }
 *                         duplicateInFileRows: { type: integer, description: 'Rows sharing a (store_id, report_month, hour) with a later row in this same file — only the last occurrence is written.' }
 *                         newStoreCount: { type: integer, description: 'Number of distinct Store IDs with no matching existing store — auto-created on commit, not treated as errors.' }
 *                         rows:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/SalesByHour'
 *                               - type: object
 *                                 properties:
 *                                   rowNumber: { type: integer }
 *                                   status: { type: string, enum: [new, update, invalid, duplicate_in_file] }
 *                                   errors: { type: array, items: { type: string } }
 *                                   storeId: { type: string, nullable: true, example: '1001', description: 'The canonical Store ID — this IS store.id (same value as reportStoreId, as a string), not a UUID.' }
 *                                   willCreateStore: { type: boolean }
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
 *                 newStoreCount: 0
 *                 rows:
 *                   - rowNumber: 4
 *                     status: update
 *                     errors: []
 *                     willCreateStore: false
 *                     reportStoreId: 1001
 *                     storeId: '1001'
 *                     brandName: ABC
 *                     storeName: ABC Central
 *                     reportMonth: '2026-07-01'
 *                     hour: 1
 *                     grossSale: 1150
 *                   - rowNumber: 5
 *                     status: new
 *                     errors: []
 *                     willCreateStore: false
 *                     reportStoreId: 1001
 *                     storeId: '1001'
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
 *       Every row that passes validation is written via an atomic upsert on
 *       the (store_id, report_month, hour) unique constraint: a key not
 *       already in sales_by_hour is inserted, a key that already exists is
 *       overwritten in place with this file's data (the newly uploaded file
 *       is the source of truth — this is never rejected as a duplicate, and
 *       never raises a unique-violation). A (store_id, report_month, hour)
 *       repeated more than once within this same file is resolved
 *       deterministically before writing — the last occurrence in the file
 *       wins; earlier ones are skipped (see `skippedDuplicatesInFile`). Only
 *       rows that fail validation are excluded (see `failed`). Store IDs
 *       with no matching existing store are auto-created — the Excel Store
 *       ID becomes store.id directly (one store per distinct Store ID, even
 *       if it appears on many rows) before the sales-by-hour rows are
 *       written — see `storesCreated` in the response.
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
 *                         imported: { type: integer, description: 'Rows written this commit, insert + update combined.' }
 *                         inserted: { type: integer, description: '(store_id, report_month, hour) not previously in sales_by_hour.' }
 *                         updated: { type: integer, description: '(store_id, report_month, hour) already existed and was overwritten with this file''s data.' }
 *                         skippedDuplicatesInFile: { type: integer, description: 'Rows sharing a (store_id, report_month, hour) with a later row in this same file — not written, the later row was used instead.' }
 *                         storesCreated:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id: { type: string, example: '1001', description: 'The canonical Store ID, taken directly from the Excel file — not a UUID.' }
 *                               storeId: { type: string, example: '1001', description: 'Alias for id.' }
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
 *                 inserted: 20
 *                 updated: 3
 *                 skippedDuplicatesInFile: 0
 *                 storesCreated:
 *                   - id: '1001'
 *                     storeId: '1001'
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
