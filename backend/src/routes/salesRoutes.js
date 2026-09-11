const router = require('express').Router();
const salesController = require('../controllers/salesController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * This router is read-only on purpose.
 *
 * It used to also expose POST /sales (single-day manual entry) and POST /sales/import(/preview)
 * (a third Excel importer). All three wrote to `sales_record` — a table nothing reads and which is
 * empty chain-wide, while the Sales Report import fills `sales_report` (118,052 rows vs 0). Once
 * GET /sales and the dashboard's KPIs were repointed at `sales_report`, keeping those writes alive
 * would have meant accepting data, answering 200, and never showing it anywhere.
 *
 * Sales enter the system through the two file importers, which is the audited path the whole
 * forecast is built on:
 *   POST /sales/report/import   -> sales_report   (daily actuals; see salesReportRoutes.js)
 *   POST /sales/by-hour/import  -> sales_by_hour  (hour-of-day shape; see salesByHourRoutes.js)
 */

/**
 * @swagger
 * /sales:
 *   get:
 *     summary: Reported daily sales for a store
 *     description: >
 *       Reads `sales_report`, the table the Sales Report Excel import fills and the same source
 *       the daily forecast is built from. `report_date`/`gross_actual` are returned under the
 *       aliases `sales_date`/`amount`. Rows whose `gross_actual` is still null (future or
 *       budget-only rows with no actual reported yet) are omitted rather than returned as zero.
 *     tags: [Sales]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, example: '1001' }
 *         description: store.id — the canonical Store ID, not a UUID.
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date, example: '2026-06-01' }
 *         description: Inclusive lower bound on the report date.
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date, example: '2026-06-30' }
 *         description: Inclusive upper bound on the report date.
 *     responses:
 *       200:
 *         description: Reported days, oldest first.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: 7eb5236c-fbc3-4e99-8d9e-2e56e25c14b9
 *                   store_id: '1001'
 *                   sales_date: '2026-06-01'
 *                   amount: 27481
 *                   docket_actual: 515
 *                   customer_actual: 663
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, authorize('sales:view'), storeScope, salesController.list);

module.exports = router;
