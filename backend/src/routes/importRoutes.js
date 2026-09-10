const router = require('express').Router();
const importController = require('../controllers/importController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * NOTE: POST /store/import (importService.importStores — upserts stores by
 * NAME, columns "name, region") is intentionally undocumented here — no
 * frontend caller, no internal caller, and it's fully superseded by the
 * real Store Master Import (POST /store/master/import, matching the actual
 * company file: Effective Date/ID/BRANCH/Zone Update + Area Coach
 * resolution). The route still exists and works — only removed from Swagger.
 */

/**
 * @swagger
 * /import:
 *   post:
 *     summary: Generic bulk import via Excel (.xlsx) into a registered table (store, laborGuideline)
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
