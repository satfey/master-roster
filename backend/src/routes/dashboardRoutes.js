const router = require('express').Router();
const dashboardController = require('../controllers/dashboardController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

/**
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
 *                               storeId: { type: string, format: uuid }
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
 *                   - store: { id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1, name: Bangna Store, region: Bangkok, area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002 }
 *                     storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     salesActual: 30200
 *                     forecastSales: 32000
 *                     plannedHours: 16
 *                     actualHours: 15.5
 *                     allowedHours: 27
 *                     remainingHours: 11.5
 *                     laborPercent: 57.41
 *                     productivity: 1948.39
 *                 topPerformingStore: { storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1, productivity: 1948.39 }
 *                 worstPerformingStore: { storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2, productivity: 0 }
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
 *       No store-scope check is applied on this route (unlike most other
 *       store-scoped endpoints) — any authenticated caller with
 *       `productivity:view` can query any store id.
 *     tags: [Dashboard]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Store ID
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
 *                         storeId: { type: string, format: uuid }
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
 *                 storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
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
router.get('/store/:id', authenticate, authorize('productivity:view'), dashboardController.storeDashboard);

module.exports = router;
