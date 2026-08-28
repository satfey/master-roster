const router = require('express').Router();
const laborController = require('../controllers/laborController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * @swagger
 * /labor:
 *   get:
 *     summary: Labor hour summary (planned, actual, remaining, %) for a store
 *     tags: [Labor]
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
 *         description: Labor summary
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
 *                         shifts:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/Shift'
 *                               - type: object
 *                                 properties:
 *                                   actual_hours:
 *                                     allOf:
 *                                       - $ref: '#/components/schemas/ActualHours'
 *                                     nullable: true
 *                                   employee: { $ref: '#/components/schemas/Employee' }
 *                         plannedHours: { type: number }
 *                         actualHours: { type: number }
 *                         allowedHours: { type: number, nullable: true }
 *                         remainingHours: { type: number, nullable: true }
 *                         laborPercent: { type: number, nullable: true }
 *                         isOverBudget: { type: boolean, nullable: true }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 shifts: []
 *                 plannedHours: 16
 *                 actualHours: 15.5
 *                 allowedHours: 27
 *                 remainingHours: 11.5
 *                 laborPercent: 57.41
 *                 isOverBudget: false
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   put:
 *     summary: Record actual worked hours for a shift
 *     description: Upserts the 1:1 actual_hours row for the given shift (one record per shift).
 *     tags: [Labor]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shiftId, actualHours]
 *             properties:
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               actualHours:
 *                 type: number
 *                 format: float
 *               clockIn:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               clockOut:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *           example:
 *             shiftId: 17171717-1717-1717-1717-171717171701
 *             actualHours: 8
 *             clockIn: 2026-08-03T08:01:00
 *             clockOut: 2026-08-03T16:05:00
 *     responses:
 *       200:
 *         description: >
 *           Actual hours recorded. If actualHours exceeds the shift's
 *           planned_hours, `message` instead reads "Warning: actual hours
 *           exceed the planned shift hours" (still a 200).
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       allOf:
 *                         - $ref: '#/components/schemas/ActualHours'
 *                         - type: object
 *                           properties:
 *                             plannedHours: { type: number }
 *                             isOverPlanned: { type: boolean }
 *             example:
 *               success: true
 *               message: Actual hours recorded
 *               data:
 *                 id: 6abfb151-0429-43ac-9c8e-ba6d67430a75
 *                 shift_id: 17171717-1717-1717-1717-171717171701
 *                 actual_hours: 6.5
 *                 clock_in: null
 *                 clock_out: null
 *                 recorded_by: null
 *                 plannedHours: 7
 *                 isOverPlanned: false
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: The given shiftId does not exist.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'Shift not found', errors: null }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /labor/tiers:
 *   get:
 *     summary: List Sales/Budget -> Labor Hours guideline tiers
 *     description: >
 *       PHASE 2's business guideline for converting a store's daily
 *       sales/budget level into an allowed labor-hour figure. Starts empty
 *       — no values are hard-coded in application code; until tiers exist
 *       here, roster generation falls back to sizing labor hours from
 *       LaborGuideline.target_productivity alone (Phase 1 behavior).
 *       weekday_labor_hours / weekend_labor_hours (Saturday/Sunday counts
 *       as weekend) take priority over the legacy flat allowed_labor_hours
 *       when both are set on a tier — a tier only needs one or the other,
 *       not both. Pass storeId to include that store's own overrides plus
 *       the global defaults (storeId omitted on a tier); omit storeId to
 *       list every tier across every store.
 *     tags: [Labor]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         schema: { type: string, example: '1005' }
 *     responses:
 *       200:
 *         description: Tiers
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: 1c1c1c1c-1c1c-1c1c-1c1c-1c1c1c1c1c01
 *                   store_id: null
 *                   sales_min: 0
 *                   sales_max: 6000
 *                   allowed_labor_hours: 12
 *                   weekday_labor_hours: 12
 *                   weekend_labor_hours: 12
 *                   level: 1
 *                   standard_working_hours: null
 *                   min_staff_count: null
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   post:
 *     summary: Create a Sales/Budget -> Labor Hours tier
 *     tags: [Labor]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [salesMin, salesMax]
 *             description: Provide either allowedLaborHours, or both weekdayLaborHours and weekendLaborHours.
 *             properties:
 *               storeId: { type: string, nullable: true, description: 'Omit for a global default tier', example: '1005' }
 *               salesMin: { type: number, example: 200000 }
 *               salesMax: { type: number, example: 249999 }
 *               allowedLaborHours: { type: number, nullable: true, description: 'Legacy flat figure for a tier that does not distinguish weekday/weekend' }
 *               weekdayLaborHours: { type: number, nullable: true, example: 25 }
 *               weekendLaborHours: { type: number, nullable: true, description: 'Saturday/Sunday', example: 28 }
 *               level: { type: integer, nullable: true, description: 'The Master-Revise sheet''s "Level" column', example: 1 }
 *               standardWorkingHours: { type: number, nullable: true, description: 'The Master-Revise sheet''s "Standard Working Day" column' }
 *               minStaffCount: { type: integer, nullable: true, description: 'The Master-Revise sheet''s "Staff requirement" column' }
 *           example:
 *             salesMin: 200000
 *             salesMax: 249999
 *             weekdayLaborHours: 25
 *             weekendLaborHours: 28
 *     responses:
 *       201:
 *         description: Tier created
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /labor/tiers/{id}:
 *   put:
 *     summary: Update a Sales/Budget -> Labor Hours tier
 *     tags: [Labor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               salesMin: { type: number }
 *               salesMax: { type: number }
 *               allowedLaborHours: { type: number, nullable: true }
 *               weekdayLaborHours: { type: number, nullable: true }
 *               weekendLaborHours: { type: number, nullable: true }
 *               level: { type: integer, nullable: true }
 *               standardWorkingHours: { type: number, nullable: true }
 *               minStaffCount: { type: integer, nullable: true }
 *     responses:
 *       200:
 *         description: Tier updated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   delete:
 *     summary: Delete a Sales/Budget -> Labor Hours tier
 *     tags: [Labor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tier deleted
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, authorize('labor:view'), storeScope, laborController.summary);
router.put('/', authenticate, authorize('labor:input'), laborController.recordHours);
router.get('/tiers', authenticate, authorize('labor:view'), laborController.listTiers);
router.post('/tiers', authenticate, authorize('labor:input'), laborController.createTier);
router.put('/tiers/:id', authenticate, authorize('labor:input'), laborController.updateTier);
router.delete('/tiers/:id', authenticate, authorize('labor:input'), laborController.deleteTier);

module.exports = router;
