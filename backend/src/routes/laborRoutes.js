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
 */
router.get('/', authenticate, authorize('labor:view'), storeScope, laborController.summary);
router.put('/', authenticate, authorize('labor:input'), laborController.recordHours);

module.exports = router;
