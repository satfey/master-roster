const router = require('express').Router();
const storeMasterController = require('../controllers/storeMasterController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /store/master/import/preview:
 *   post:
 *     summary: Parse and validate a Store Master Excel file without importing it
 *     description: >
 *       Expects a .xlsx file with a fixed 4-column layout (A-D) — Effective
 *       Date, ID, BRANCH, Zone Update. The header row is detected by content,
 *       not a fixed row number. Column B (ID) maps to store.storeCode
 *       (preserved as a string — leading zeros are never stripped). Column C
 *       (BRANCH) maps to store.name. Column D (Zone Update) is matched
 *       (case/whitespace-normalized) against the full_name of active users
 *       holding the Area Coach role; the resolved user.id is written to
 *       store.area_coach_id. Column A (Effective Date) is informational only
 *       and is never persisted.
 *       If Zone Update is blank OR names an Area Coach that doesn't exist
 *       yet, the row is still valid — the store is saved with
 *       area_coach_id = NULL and a note is added to `warnings` (not
 *       `errors`) so it can be backfilled by re-importing the same file once
 *       that Area Coach is added to `users`. Only an AMBIGUOUS match (the
 *       name resolves to more than one Area Coach) blocks the row, since
 *       guessing which one was meant would be wrong regardless of timing.
 *       A Store ID already present in store.storeCode resolves to UPDATE
 *       (name + area_coach_id only — storeCode/id/region are never touched);
 *       a Store ID with no match resolves to CREATE; a row that would change
 *       nothing resolves to NO_CHANGE. Preview never writes to the database.
 *     tags: [Store Master]
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
 *                         duplicateRows: { type: integer, description: 'Rows whose Store ID (column B) repeats elsewhere in the same file.' }
 *                         newStoreCount: { type: integer }
 *                         updateStoreCount: { type: integer }
 *                         rows:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               status: { type: string, enum: [valid, invalid] }
 *                               errors: { type: array, items: { type: string } }
 *                               warnings: { type: array, items: { type: string }, description: 'Non-blocking notes, e.g. an unmatched Area Coach — the row is still valid.' }
 *                               effectiveDate: { type: string, nullable: true, description: 'Informational only — never persisted.' }
 *                               storeCode: { type: string, nullable: true, example: '1001' }
 *                               branch: { type: string, nullable: true, example: 'Bangna Store' }
 *                               areaCoachName: { type: string, nullable: true, example: 'Alice Area Coach' }
 *                               resolvedAreaCoachId: { type: string, format: uuid, nullable: true }
 *                               action: { type: string, nullable: true, enum: [CREATE, UPDATE, NO_CHANGE] }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 totalRows: 2
 *                 validRows: 2
 *                 invalidRows: 0
 *                 duplicateRows: 0
 *                 newStoreCount: 1
 *                 updateStoreCount: 0
 *                 rows:
 *                   - rowNumber: 4
 *                     status: valid
 *                     errors: []
 *                     warnings: []
 *                     effectiveDate: '2026-07-01'
 *                     storeCode: '1001'
 *                     branch: Bangna Store
 *                     areaCoachName: Alice Area Coach
 *                     resolvedAreaCoachId: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
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
 * /store/master/import:
 *   post:
 *     summary: Bulk import a Store Master Excel file (create/update stores)
 *     description: >
 *       For every valid row: creates the store if storeCode doesn't exist
 *       yet, or updates name/area_coach_id if it does (storeCode/id/region
 *       are never touched, Effective Date is never persisted). A Store ID
 *       repeated in the same file with matching Branch/Area Coach is only
 *       written once; a repeat with conflicting values is rejected on every
 *       affected row instead of picking one arbitrarily. Re-importing the
 *       same file is idempotent — it results in the same database state.
 *     tags: [Store Master]
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
 *                               storeCode: { type: string, nullable: true }
 *                               errors: { type: array, items: { type: string } }
 *                         storesCreated:
 *                           type: array
 *                           items: { $ref: '#/components/schemas/Store' }
 *                         storesUpdated:
 *                           type: array
 *                           items: { $ref: '#/components/schemas/Store' }
 *             example:
 *               success: true
 *               message: Store master data imported
 *               data:
 *                 total: 2
 *                 created: 1
 *                 updated: 1
 *                 unchanged: 0
 *                 failed: []
 *                 storesCreated:
 *                   - id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9
 *                     storeCode: '1002'
 *                     name: New Store
 *                     area_coach_id: null
 *                 storesUpdated:
 *                   - id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     storeCode: '1001'
 *                     name: Bangna Store
 *                     area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
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
router.post('/import/preview', authenticate, authorize('branch:manage'), upload.single('file'), storeMasterController.storeMasterImportPreview);
router.post('/import', authenticate, authorize('branch:manage'), upload.single('file'), storeMasterController.storeMasterImport);

module.exports = router;
