const router = require('express').Router();
const importController = require('../controllers/importController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /store/import:
 *   post:
 *     summary: Bulk import store data via Excel (.xlsx)
 *     description: Upserts by store name — updates the region if the store already exists, otherwise creates it.
 *     tags: [Import]
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
 *                 description: .xlsx file with columns name, region
 *     responses:
 *       200:
 *         description: Import result
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
 *                         imported: { type: integer }
 *                         total: { type: integer }
 *                         errors:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               row: { type: integer }
 *                               message: { type: string }
 *             example:
 *               success: true
 *               message: Store data imported
 *               data: { imported: 3, total: 3, errors: [] }
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
 * /import:
 *   post:
 *     summary: Generic bulk import via Excel (.xlsx) into a registered table (employee, store, laborGuideline)
 *     description: >
 *       Validates every row up front and only inserts if the whole file is
 *       clean. **Note:** unlike every other endpoint in this API, this one
 *       intentionally bypasses the standard `{ success, message, data }`
 *       envelope and returns its result object directly, with its own
 *       `success` boolean — see the 201 vs 422 response bodies below.
 *     tags: [Import]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, entity]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: .xlsx file matching the chosen entity's expected columns
 *               entity:
 *                 type: string
 *                 enum: [store, laborGuideline]
 *                 description: Which registered table to import into (employee moved to its own preview/commit flow — see POST /employee/import/preview and /employee/import)
 *     responses:
 *       201:
 *         description: Every row was valid and inserted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 total: { type: integer }
 *                 inserted: { type: integer }
 *                 failed: { type: integer, example: 0 }
 *             example:
 *               success: true
 *               total: 5
 *               inserted: 5
 *               failed: 0
 *       422:
 *         description: One or more rows failed validation — nothing was inserted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 total: { type: integer }
 *                 inserted: { type: integer, example: 0 }
 *                 failed: { type: integer }
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       row: { type: integer }
 *                       messages: { type: array, items: { type: string } }
 *             example:
 *               success: false
 *               total: 5
 *               inserted: 0
 *               failed: 1
 *               errors:
 *                 - row: 4
 *                   messages: ['Unknown store_code: XX99']
 *       400:
 *         description: No file uploaded, missing "entity" field, unknown entity, empty file, or missing required columns.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'Missing required field "entity" (e.g. store, laborGuideline)', errors: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/store/import', authenticate, authorize('branch:manage'), upload.single('file'), importController.storeImport);
router.post('/import', authenticate, authorize('data:import'), upload.single('file'), importController.genericImport);

module.exports = router;
