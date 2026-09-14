const router = require('express').Router();
const dashboardController = require('../controllers/dashboardController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * NOTE: GET /dashboard and GET /dashboard/store/:id are intentionally
 * undocumented here — no frontend caller, no internal caller, and they
 * compute productivity from the legacy sales_record table (a separate,
 * older calculation than what rosterValidationService now does properly
 * from sales_report/hourly forecast/actual hours). The routes still exist
 * and work (see dashboardController.js) — only removed from Swagger.
 */

/*
 * @swagger
 * /dashboard:
 *   get:
 *     summary: Company-wide dashboard (store-scoped by role)
 *     description: Computes productivity live from sales/forecast/shift/actual-hours data for every store visible to the caller.
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Per-store productivity plus the top/worst performer
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
 *                         stores:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               store: { $ref: '#/components/schemas/Store' }
 *                               storeId: { type: string, example: '1001', description: 'The canonical Store ID (store.id) — not a UUID.' }
 *                               salesActual: { type: number }
 *                               forecastSales: { type: number }
 *                               plannedHours: { type: number }
 *                               actualHours: { type: number }
 *                               allowedHours: { type: number, nullable: true }
 *                               remainingHours: { type: number, nullable: true }
 *                               laborPercent: { type: number, nullable: true }
 *                               productivity: { type: number }
 *                         topPerformingStore:
 *                           type: object
 *                           nullable: true
 *                         worstPerformingStore:
 *                           type: object
 *                           nullable: true
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 stores:
 *                   - store: { id: '1001', storeId: '1001', name: Bangna Store, region: Bangkok, area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002 }
 *                     storeId: '1001'
 *                     salesActual: 30200
 *                     forecastSales: 32000
 *                     plannedHours: 16
 *                     actualHours: 15.5
 *                     allowedHours: 27
 *                     remainingHours: 11.5
 *                     laborPercent: 57.41
 *                     productivity: 1948.39
 *                 topPerformingStore: { storeId: '1001', productivity: 1948.39 }
 *                 worstPerformingStore: { storeId: '1002', productivity: 0 }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /dashboard/store/{id}:
 *   get:
 *     summary: Single-store productivity dashboard
 *     description: >
 *       Store-scoped: a Store Manager may only query their own store and an Area Coach only
 *       stores in their area. Every role that can reach this route holds `productivity:view`,
 *       so the permission alone does not decide which store's figures are returned.
 *     tags: [Dashboard]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: '1001' }
 *         description: Store ID (store.id) — not a UUID
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Productivity summary for the store
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
 *                         storeId: { type: string, example: '1001', description: 'The canonical Store ID (store.id) — not a UUID.' }
 *                         salesActual: { type: number }
 *                         forecastSales: { type: number }
 *                         plannedHours: { type: number }
 *                         actualHours: { type: number }
 *                         allowedHours: { type: number, nullable: true }
 *                         remainingHours: { type: number, nullable: true }
 *                         laborPercent: { type: number, nullable: true }
 *                         productivity: { type: number }
 *                         series:
 *                           type: object
 *                           properties:
 *                             salesRecords:
 *                               type: array
 *                               items: { $ref: '#/components/schemas/SalesRecord' }
 *                             forecasts:
 *                               type: array
 *                               items: { $ref: '#/components/schemas/SalesForecast' }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 storeId: '1001'
 *                 salesActual: 30200
 *                 forecastSales: 32000
 *                 plannedHours: 16
 *                 actualHours: 15.5
 *                 allowedHours: 27
 *                 remainingHours: 11.5
 *                 laborPercent: 57.41
 *                 productivity: 1948.39
 *                 series: { salesRecords: [], forecasts: [] }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, authorize('productivity:view'), dashboardController.companyDashboard);
// storeScope is load-bearing here, not decoration: this route returns a store's real per-day
// gross sales actuals, and `productivity:view` is held by STORE_MANAGER and AREA_COACH alike.
// Without it, any manager could read any store's revenue by changing the id in the URL — and
// store.id is a short sequential business code ('1001', '1002', ...), not an unguessable UUID,
// so the whole chain would be enumerable. storeScope resolves req.params.id, which is exactly
// the store id this route takes.
router.get('/store/:id', authenticate, authorize('productivity:view'), storeScope, dashboardController.storeDashboard);

module.exports = router;
