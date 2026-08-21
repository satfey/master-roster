const router = require('express').Router();
const rosterController = require('../controllers/rosterController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * @swagger
 * /roster/generate:
 *   post:
 *     summary: Auto-generate a weekly roster (shifts) within the labor-hour budget
 *     tags: [Roster]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, weekStart]
 *             properties:
 *               storeId:
 *                 type: string
 *                 format: uuid
 *               weekStart:
 *                 type: string
 *                 format: date
 *                 description: Start date (Monday) of the week to generate
 *               forecastedSales:
 *                 type: number
 *                 format: float
 *                 description: Used with the store's targetProductivity to derive the allowed labor hours
 *               allowedHoursOverride:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *                 description: Skip the forecast-derived budget and cap total scheduled hours directly
 *           example:
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *             weekStart: 2026-08-10
 *             forecastedSales: 45000
 *     responses:
 *       201:
 *         description: Roster generated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       allOf:
 *                         - $ref: '#/components/schemas/Roster'
 *                         - type: object
 *                           properties:
 *                             shift:
 *                               type: array
 *                               items:
 *                                 allOf:
 *                                   - $ref: '#/components/schemas/Shift'
 *                                   - type: object
 *                                     properties:
 *                                       employee: { $ref: '#/components/schemas/Employee' }
 *                             allowedHours: { type: number }
 *                             totalScheduledHours: { type: number }
 *             example:
 *               success: true
 *               message: Roster generated
 *               data:
 *                 id: f69dde10-f1b2-49e5-97ed-caac5809b7ca
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 week_start: '2026-08-09'
 *                 status: DRAFT
 *                 approved_by: null
 *                 approved_at: null
 *                 shift:
 *                   - id: 564ffd50-74cc-45cb-81b8-f682f881b732
 *                     roster_id: f69dde10-f1b2-49e5-97ed-caac5809b7ca
 *                     employee_id: '000123'
 *                     shift_date: '2026-08-09'
 *                     start_time: '08:00:00'
 *                     end_time: '16:00:00'
 *                     planned_hours: 7
 *                     employee:
 *                       id: '000123'
 *                       store_id: '1001'
 *                       first_name: Somchai
 *                       last_name: Jaidee
 *                       position: Cashier
 *                       is_active: true
 *                 allowedHours: 38
 *                 totalScheduledHours: 35
 *       400:
 *         description: No active employees found for this store.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'No active employees found for this store', errors: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /roster:
 *   get:
 *     summary: List generated rosters for a store
 *     tags: [Roster]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of rosters, each with its shifts (and each shift's employee + recorded actual hours) embedded
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
 *                           - $ref: '#/components/schemas/Roster'
 *                           - type: object
 *                             properties:
 *                               shift:
 *                                 type: array
 *                                 items:
 *                                   allOf:
 *                                     - $ref: '#/components/schemas/Shift'
 *                                     - type: object
 *                                       properties:
 *                                         employee: { $ref: '#/components/schemas/Employee' }
 *                                         actual_hours:
 *                                           allOf:
 *                                             - $ref: '#/components/schemas/ActualHours'
 *                                           nullable: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /roster/{id}:
 *   get:
 *     summary: Get a single roster with its shifts
 *     description: Unlike the other roster routes, this one only requires authentication — no permission or store-scope check is applied.
 *     tags: [Roster]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Roster with shifts (and each shift's employee + actual hours) embedded
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       allOf:
 *                         - $ref: '#/components/schemas/Roster'
 *                         - type: object
 *                           properties:
 *                             shift:
 *                               type: array
 *                               items:
 *                                 allOf:
 *                                   - $ref: '#/components/schemas/Shift'
 *                                   - type: object
 *                                     properties:
 *                                       employee: { $ref: '#/components/schemas/Employee' }
 *                                       actual_hours:
 *                                         allOf:
 *                                           - $ref: '#/components/schemas/ActualHours'
 *                                         nullable: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   put:
 *     summary: Update a roster's status and/or reassign employees on its shifts
 *     description: >
 *       Updating a non-existent id currently surfaces as a 500 (the query
 *       uses `.single()`, which errors on zero matching rows) rather than 404.
 *     tags: [Roster]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 example: APPROVED
 *                 description: e.g. DRAFT, APPROVED
 *               shifts:
 *                 type: array
 *                 description: Optional — reassign the employee on one or more existing shifts
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                       description: Shift ID
 *                     employeeId:
 *                       type: string
 *                       description: employee.id — the Employee ID from the source file, not a UUID
 *           example:
 *             status: APPROVED
 *             shifts:
 *               - id: 17171717-1717-1717-1717-171717171701
 *                 employeeId: '000123'
 *     responses:
 *       200:
 *         description: Roster updated (response is the roster row only — reassigned shifts are not re-embedded)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Roster' }
 *             example:
 *               success: true
 *               message: Roster updated
 *               data:
 *                 id: f69dde10-f1b2-49e5-97ed-caac5809b7ca
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 week_start: '2026-08-09'
 *                 status: APPROVED
 *                 approved_by: null
 *                 approved_at: null
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   delete:
 *     summary: Delete a roster and all of its shifts
 *     tags: [Roster]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Roster deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiResponse' }
 *             example: { success: true, message: 'Roster deleted', data: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/generate', authenticate, authorize('schedule:generate'), storeScope, rosterController.generate);
router.get('/', authenticate, authorize('schedule:generate'), storeScope, rosterController.list);
router.get('/:id', authenticate, rosterController.getOne);
router.put('/:id', authenticate, authorize('schedule:update'), rosterController.update);
router.delete('/:id', authenticate, authorize('schedule:delete'), rosterController.remove);

module.exports = router;
