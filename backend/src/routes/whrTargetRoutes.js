const router = require('express').Router();
const whrTargetController = require('../controllers/whrTargetController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /whr-target/import/preview:
 *   post:
 *     summary: Preview a WHR Target import (Excel .xlsx) — validates without writing
 *     description: >
 *       WHR Target is a monthly per-store performance report (WHRS = hours
 *       actually used that month, Productivity, COG, Sales). The reporting
 *       month is read from the workbook's own PERIOD cell — never a
 *       caller-supplied field. Every row's COG is validated against the
 *       business rule COG <= 33% of Sales (`cogOverLimitRows`/per-row
 *       `errors`); Sales = 0 is handled without dividing by zero (see
 *       `errors` on that row instead of a fabricated percentage). Unlike
 *       Sales Report/Store Master, an unrecognized store CODE is a
 *       validation error, not an auto-created store — WHR Target reports on
 *       stores that must already exist.
 *     tags: [WHR Target]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Preview result.
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
 *                         reportMonth: { type: string, example: '2026-07-01', description: 'Read from the file''s own PERIOD cell.' }
 *                         totalRows: { type: integer }
 *                         storeCount: { type: integer }
 *                         newRows: { type: integer }
 *                         updateRows: { type: integer }
 *                         validRows: { type: integer }
 *                         invalidRows: { type: integer }
 *                         duplicateInFileRows: { type: integer }
 *                         cogOverLimitRows: { type: integer, description: 'Rows failing the COG <= 33% of Sales rule.' }
 *                         rows:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               status: { type: string, enum: [new, update, invalid, duplicate_in_file] }
 *                               storeId: { type: string, example: '1001' }
 *                               storeName: { type: string, nullable: true, example: 'Store Name ABC' }
 *                               reportMonth: { type: string, example: '2026-07-01' }
 *                               monthlySales: { type: number, nullable: true }
 *                               whrs: { type: number, nullable: true }
 *                               productivity: { type: number, nullable: true }
 *                               cog: { type: number, nullable: true }
 *                               cogPercent: { type: number, nullable: true, description: 'cog / monthlySales; null when monthlySales is 0 or missing.' }
 *                               errors: { type: array, items: { type: string } }
 *             example:
 *               success: true
 *               message: Preview generated
 *               data:
 *                 reportMonth: '2026-07-01'
 *                 totalRows: 3
 *                 storeCount: 3
 *                 newRows: 2
 *                 updateRows: 1
 *                 validRows: 3
 *                 invalidRows: 0
 *                 duplicateInFileRows: 0
 *                 cogOverLimitRows: 1
 *                 rows:
 *                   - { rowNumber: 13, status: new, storeId: '1001', storeName: 'Store Name ABC', reportMonth: '2026-07-01', monthlySales: 500000, whrs: 620, productivity: 190.5, cog: 175000, cogPercent: 0.35, errors: ['COG 35.0% exceeds the 33% limit (COG 175000 / Sales 500000)'] }
 *       400:
 *         description: No file uploaded, or the WHR Target header row / PERIOD cell could not be found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /whr-target/import:
 *   post:
 *     summary: Commit a WHR Target import (Excel .xlsx)
 *     description: >
 *       Every valid row is written via an atomic upsert on the (store_id,
 *       report_month) unique constraint: a key not already in
 *       whr_target_monthly is inserted, a key that already exists is
 *       overwritten in place with this file's numbers (the newly uploaded
 *       file is the source of truth — never rejected as a duplicate, never
 *       a 23505 unique-violation). A store CODE repeated more than once
 *       within this same file is resolved deterministically before writing
 *       (last occurrence wins; earlier ones are skipped — see
 *       `skippedDuplicatesInFile`). Rows failing validation (unknown store
 *       CODE, missing CODE, COG > 33% of Sales, or an unresolvable
 *       Sales=0/COG-nonzero row) are excluded — see `failed`.
 *     tags: [WHR Target]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Import result.
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
 *                         reportMonth: { type: string, example: '2026-07-01' }
 *                         total: { type: integer }
 *                         imported: { type: integer, description: 'Rows written this commit, insert + update combined.' }
 *                         inserted: { type: integer }
 *                         updated: { type: integer }
 *                         skippedDuplicatesInFile: { type: integer }
 *                         failed:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rowNumber: { type: integer }
 *                               storeId: { type: string, nullable: true }
 *                               errors: { type: array, items: { type: string } }
 *             example:
 *               success: true
 *               message: WHR Target data imported
 *               data: { reportMonth: '2026-07-01', total: 3, imported: 2, inserted: 1, updated: 1, skippedDuplicatesInFile: 0, failed: [{ rowNumber: 14, storeId: '1002', errors: ['COG 40.0% exceeds the 33% limit (COG 200000 / Sales 500000)'] }] }
 *       400:
 *         description: No file was uploaded, or the header row / PERIOD cell could not be found.
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
router.post('/import/preview', authenticate, authorize('sales:import'), upload.single('file'), whrTargetController.whrTargetImportPreview);
router.post('/import', authenticate, authorize('sales:import'), upload.single('file'), whrTargetController.whrTargetImport);

module.exports = router;
