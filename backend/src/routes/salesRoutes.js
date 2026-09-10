const router = require('express').Router();
const salesController = require('../controllers/salesController');
const importController = require('../controllers/importController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * NOTE: GET /sales and POST /sales (salesController.list/create — plain
 * CRUD on sales_record) are intentionally undocumented here — no frontend
 * caller (the frontend's actual Sales Import feature below writes to
 * sales_record via file upload, never through this CRUD pair directly) and
 * no internal caller. The routes still exist and work — only removed from
 * Swagger.
 */

/**
 * @swagger
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
