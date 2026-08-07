const router = require('express').Router();
const salesController = require('../controllers/salesController');
const importController = require('../controllers/importController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /sales:
 *   get:
 *     summary: List sales records for a store
 *     tags: [Sales]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         description: Inclusive lower bound on sales_date
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         description: Inclusive upper bound on sales_date
 *     responses:
 *       200:
 *         description: List of sales records
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/SalesRecord'
 *                           - type: object
 *                             properties:
 *                               sourceType: { $ref: '#/components/schemas/SalesSourceType' }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: eeeeeeee-eeee-eeee-eeee-eeeeeeee0001
 *                   store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                   sales_date: '2026-07-25'
 *                   amount: 25000
 *                   source_type_id: dddddddd-dddd-dddd-dddd-dddddddd0001
 *                   entered_by: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003
 *                   created_at: '2026-07-31T03:25:54.489843'
 *                   sourceType: { id: dddddddd-dddd-dddd-dddd-dddddddd0001, name: POS }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   post:
 *     summary: Create a sales record for a specific date
 *     tags: [Sales]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, date, amount]
 *             properties:
 *               storeId:
 *                 type: string
 *                 format: uuid
 *               date:
 *                 type: string
 *                 format: date
 *               amount:
 *                 type: number
 *                 format: float
 *               sourceTypeName:
 *                 type: string
 *                 default: MANUAL_ENTRY
 *                 description: Sales channel (e.g. POS, Grab, MANUAL_ENTRY) — created if it doesn't already exist
 *           example:
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *             date: 2026-08-03
 *             amount: 25000
 *             sourceTypeName: MANUAL_ENTRY
 *     responses:
 *       201:
 *         description: Sales record created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/SalesRecord' }
 *             example:
 *               success: true
 *               message: Sales record created
 *               data:
 *                 id: 22b8e718-8bb4-4fa9-b292-8e4870ae5658
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 sales_date: '2026-08-03'
 *                 amount: 9999
 *                 source_type_id: 08646dbd-931c-4812-ad96-31647c0448bb
 *                 entered_by: null
 *                 created_at: '2026-08-03T04:40:34.81931'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /sales/import/preview:
 *   post:
 *     summary: Parse and validate a sales Excel report without importing it
 *     tags: [Sales]
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
 *                 description: .xlsx file with columns storeCode, salesDate, salesAmount, docket, labourHours
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
 *                         rows:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               storeCode: { type: string, nullable: true }
 *                               storeId: { type: string, format: uuid, nullable: true }
 *                               storeName: { type: string, nullable: true }
 *                               salesDate: { type: string, format: date, nullable: true }
 *                               salesAmount: { type: number, nullable: true }
 *                               docket: { type: number, nullable: true }
 *                               labourHours: { type: number, nullable: true }
 *                               status: { type: string, enum: [valid, invalid, duplicate] }
 *                               errors: { type: array, items: { type: string } }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 totalRows: 2
 *                 validRows: 1
 *                 invalidRows: 0
 *                 duplicateRows: 1
 *                 rows:
 *                   - rowNumber: 2
 *                     storeCode: BNA01
 *                     storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     storeName: Bangna Store
 *                     salesDate: '2026-08-03'
 *                     salesAmount: 25000
 *                     docket: 120
 *                     labourHours: 40
 *                     status: valid
 *                     errors: []
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
 * /sales/import:
 *   post:
 *     summary: Bulk import sales data via Excel (.xlsx)
 *     description: Only rows that pass validation and aren't duplicates are inserted; the response reports what happened to every row.
 *     tags: [Sales]
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
 *                 description: .xlsx file with columns storeCode, salesDate, salesAmount, docket, labourHours
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
 *                         failed:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               storeCode: { type: string, nullable: true }
 *                               errors: { type: array, items: { type: string } }
 *             example:
 *               success: true
 *               message: Sales data imported
 *               data:
 *                 total: 10
 *                 imported: 8
 *                 skippedDuplicates: 1
 *                 failed:
 *                   - rowNumber: 5
 *                     storeCode: XX99
 *                     errors: ['Unknown store code: XX99']
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
router.get('/', authenticate, authorize('sales:view'), storeScope, salesController.list);
router.post('/', authenticate, authorize('sales:update'), salesController.create);
router.post('/import/preview', authenticate, authorize('sales:import'), upload.single('file'), importController.salesImportPreview);
router.post('/import', authenticate, authorize('sales:import'), upload.single('file'), importController.salesImport);

module.exports = router;
