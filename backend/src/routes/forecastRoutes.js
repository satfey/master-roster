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
 * /forecast/hourly:
 *   post:
 *     summary: Generate an hourly sales forecast for a store over a date range
 *     description: >
 *       Statistical baseline, not ML: forecasted_sales(date, hour) =
 *       dailyForecast(date) x hourFraction(hour). dailyForecast is a
 *       weekday-aware average from sales_report history (same store + same
 *       weekday, falling back to the store's overall daily average, or 0
 *       with no history). hourFraction is the store's historical
 *       hour-of-day sales shape from sales_by_hour (falling back to a
 *       chain-wide shape, or an equal 1/13 share per operating hour as a
 *       last resort). Persists into the existing sales_forecast table —
 *       daypart = 'HOUR_09'..'HOUR_21' for these rows, vs. 'FULL_DAY' for
 *       POST /forecast above; no schema change was needed.
 *     tags: [Forecast]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, startDate, endDate]
 *             properties:
 *               storeId: { type: string, example: '1005' }
 *               startDate: { type: string, format: date, example: '2026-08-24' }
 *               endDate: { type: string, format: date, example: '2026-08-30' }
 *           example:
 *             storeId: '1005'
 *             startDate: '2026-08-24'
 *             endDate: '2026-08-30'
 *     responses:
 *       200:
 *         description: Hourly forecast generated
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
 *                         modelRunId: { type: string, format: uuid }
 *                         hourShapeSource: { type: string, enum: [STORE_HOUR_SHAPE, CHAIN_HOUR_SHAPE, UNIFORM_FALLBACK] }
 *                         totalForecast: { type: number }
 *                         days:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               dailyForecast: { type: number }
 *                               dailyForecastSource: { type: string, enum: [STORE_WEEKDAY_AVERAGE, STORE_DAILY_AVERAGE, NO_HISTORY] }
 *                               hours:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     hour: { type: integer }
 *                                     forecastedSales: { type: number }
 *             example:
 *               success: true
 *               message: Hourly forecast generated
 *               data:
 *                 modelRunId: 95a070a8-9a30-4547-8d81-06e87c49b973
 *                 hourShapeSource: STORE_HOUR_SHAPE
 *                 totalForecast: 32000
 *                 days:
 *                   - date: '2026-08-24'
 *                     dailyForecast: 32000
 *                     dailyForecastSource: STORE_WEEKDAY_AVERAGE
 *                     hours:
 *                       - { hour: 9, forecastedSales: 400 }
 *                       - { hour: 12, forecastedSales: 4200 }
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', authenticate, authorize('forecast:generate'), storeScope, forecastController.createForecast);
router.get('/', authenticate, authorize('forecast:view'), storeScope, forecastController.getForecast);
router.post('/hourly', authenticate, authorize('forecast:generate'), storeScope, forecastController.createHourlyForecast);

module.exports = router;
