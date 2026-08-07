const router = require('express').Router();
const forecastController = require('../controllers/forecastController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * @swagger
 * /forecast:
 *   post:
 *     summary: Generate a sales forecast for a store (SMA or Linear Regression)
 *     description: >
 *       Creates a ForecastModelRun and persists one SalesForecast row per
 *       day. Returns 200 (not 201) — the response wraps a computed summary
 *       rather than the created records directly.
 *     tags: [Forecast]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId]
 *             properties:
 *               storeId:
 *                 type: string
 *                 format: uuid
 *               days:
 *                 type: integer
 *                 default: 7
 *                 description: Number of days ahead to forecast
 *               method:
 *                 type: string
 *                 enum: [SMA, LINEAR_REGRESSION]
 *                 default: SMA
 *           example:
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *             days: 7
 *             method: SMA
 *     responses:
 *       200:
 *         description: Forecast generated
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
 *                         method: { type: string, enum: [SMA, LINEAR_REGRESSION] }
 *                         modelRunId: { type: string, format: uuid }
 *                         daily:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date-time }
 *                               forecastedSales: { type: number }
 *                         weeklyTotal: { type: number }
 *             example:
 *               success: true
 *               message: Forecast generated
 *               data:
 *                 method: SMA
 *                 modelRunId: 95a070a8-9a30-4547-8d81-06e87c49b973
 *                 daily:
 *                   - date: '2026-08-03T17:00:00.000Z'
 *                     forecastedSales: 15100
 *                   - date: '2026-08-04T17:00:00.000Z'
 *                     forecastedSales: 15100
 *                 weeklyTotal: 45300
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   get:
 *     summary: Retrieve stored forecast records for a store
 *     tags: [Forecast]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: List of forecast records
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SalesForecast' }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: 13131313-1313-1313-1313-131313131301
 *                   store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                   forecast_date: '2026-08-01'
 *                   daypart: FULL_DAY
 *                   forecasted_sales: 32000
 *                   model_run_id: 12121212-1212-1212-1212-121212121212
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', authenticate, authorize('forecast:generate'), storeScope, forecastController.createForecast);
router.get('/', authenticate, authorize('forecast:view'), storeScope, forecastController.getForecast);

module.exports = router;
