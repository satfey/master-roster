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
 *     summary: Start a Sales Report import job (Excel .xlsx) — returns a jobId immediately, runs in the background
 *     description: >
 *       Runs as a background job rather than one long request/response: a
 *       large file's actual database write can take minutes, so this
 *       endpoint only creates the job and returns its id right away (202,
 *       not 200/201). Poll GET /sales/report/import/{jobId}/progress for
 *       real status until it reaches status "completed" or "failed" — the
 *       final import result (same shape this endpoint used to return
 *       synchronously: total/imported/inserted/updated/skippedDuplicatesInFile/
 *       storesCreated/failed) is on that job's `result` field once completed.
 *       The import logic itself — validation, the (store_id, report_date)
 *       atomic upsert, in-file duplicate resolution, auto-created stores —
 *       is unchanged; only how progress is reported is new.
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
 *       202:
 *         description: Import job created and running in the background.
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
 *                         jobId: { type: string, format: uuid }
 *             example:
 *               success: true
 *               message: Import started
 *               data:
 *                 jobId: 8b1e9c2e-2f1a-4b3a-9e2a-2b6b9a3d4c5e
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
 * /sales/report/import/{jobId}/progress:
 *   get:
 *     summary: Real progress for a Sales Report import job started via POST /sales/report/import
 *     description: >
 *       Reflects the job's ACTUAL state — stage, elapsed time, and (once
 *       completed) the real result — never a simulated/interpolated
 *       percentage. Stages run in order: parsing -> transforming ->
 *       validating -> database_insert -> completed (or failed at any
 *       point). `stages[]` gives the client everything needed to render a
 *       "done stages get a checkmark, current stage shows elapsed time"
 *       panel for parsing/transforming/validating, none of which report a
 *       row-level percentage (each is one un-chunked pass over the file).
 *       database_insert is chunked (see sales_report's upsertRecords) and
 *       DOES report real row-level progress via `stageProgress` — percent,
 *       rate, and ETA computed fresh on every poll from rows actually
 *       written and real elapsed time, never estimated ahead of what has
 *       actually landed; `stageProgress` is null for every other stage. A
 *       job persists in memory for 1 hour after it starts (long enough to
 *       check back after a page refresh), then is forgotten.
 *     tags: [Sales Report]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Current job status.
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
 *                         jobId: { type: string, format: uuid }
 *                         status: { type: string, enum: [importing, completed, failed] }
 *                         stage: { type: string, enum: [parsing, transforming, validating, database_insert, completed, failed] }
 *                         statusMessage: { type: string, example: 'Writing 100000 rows to database...' }
 *                         totalRows: { type: integer, nullable: true, description: 'Known once the parsing stage finishes.' }
 *                         elapsedSeconds: { type: number, example: 151.2 }
 *                         stageProgress:
 *                           type: object
 *                           nullable: true
 *                           description: Real row-level progress for the CURRENT stage — currently only populated during database_insert (chunked writes); null for every other stage.
 *                           properties:
 *                             processedRows: { type: integer, example: 72000 }
 *                             totalRows: { type: integer, example: 100000 }
 *                             percent: { type: integer, example: 72 }
 *                             rowsPerSecond: { type: integer, example: 477 }
 *                             estimatedRemainingSeconds: { type: integer, nullable: true, example: 58 }
 *                         stages:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               name: { type: string, enum: [parsing, transforming, validating, database_insert] }
 *                               status: { type: string, enum: [pending, in_progress, completed, failed] }
 *                               durationSeconds: { type: number, nullable: true }
 *                         error: { type: string, nullable: true }
 *                         result: { type: object, nullable: true, description: 'The same shape POST /sales/report/import used to return synchronously — only present once status is "completed".' }
 *                         startedAt: { type: string, format: date-time }
 *                         completedAt: { type: string, format: date-time, nullable: true }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 jobId: 8b1e9c2e-2f1a-4b3a-9e2a-2b6b9a3d4c5e
 *                 status: importing
 *                 stage: database_insert
 *                 statusMessage: Writing 100000 rows to database...
 *                 totalRows: 100000
 *                 elapsedSeconds: 151.2
 *                 stageProgress: { processedRows: 72000, totalRows: 100000, percent: 72, rowsPerSecond: 477, estimatedRemainingSeconds: 58 }
 *                 stages:
 *                   - { name: parsing, status: completed, durationSeconds: 13.5 }
 *                   - { name: transforming, status: completed, durationSeconds: 1.0 }
 *                   - { name: validating, status: completed, durationSeconds: 1.2 }
 *                   - { name: database_insert, status: in_progress, durationSeconds: null }
 *                 error: null
 *                 result: null
 *                 startedAt: '2026-09-02T10:00:00.000Z'
 *                 completedAt: null
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: No job with this id (never existed, or its 1-hour retention window has passed).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'Import job not found', errors: null }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/import/preview', authenticate, authorize('sales:import'), upload.single('file'), salesReportController.salesReportImportPreview);
router.get('/import/:jobId/progress', authenticate, authorize('sales:import'), salesReportController.salesReportImportProgress);
router.post('/import', authenticate, authorize('sales:import'), upload.single('file'), salesReportController.salesReportImport);

module.exports = router;
