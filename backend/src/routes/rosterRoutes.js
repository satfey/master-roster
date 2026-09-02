const router = require('express').Router();
const rosterController = require('../controllers/rosterController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * @swagger
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
 * /roster/auto-generate:
 *   post:
 *     summary: Auto-generate a DRAFT roster, minimizing labor hours while respecting coverage, legal limits, and a productivity floor
 *     description: >
 *       PHASE 4 engine. target_productivity is a MINIMUM acceptable floor,
 *       not a target the generator tries to reach by adding staff — a hot
 *       hour with productivity well above the floor is left alone, never
 *       "corrected" toward it. Concretely, every operating hour gets two
 *       numbers: requiredHeadcount (the sales-independent operational
 *       minimum — min_staff_per_shift, else 1) and maxJustifiedHeadcount
 *       (floor(forecastedSales / target_productivity), i.e. the most staff
 *       that hour's sales can support without dropping below the floor —
 *       Math.floor, never ceil, so adding staff never pushes productivity
 *       under target). Staffing is built in priority order: (1) opening
 *       (09:00) and (2) closing (22:00) coverage, both mandatory; (3) every
 *       hour reaches its operational minimum; (4) the store's rolling
 *       monthly capacity (labor_guideline.monthly_labor_hours minus
 *       actual-or-planned hours already committed — see
 *       POST /roster/actual-hours) and (5) the day's labor-hour budget (the
 *       matched Sales/Budget -> Labor Hours tier via GET /labor/tiers, or a
 *       target_productivity-derived fallback while no tier matches) are
 *       hard ceilings, never fill targets; only then are (6/7) extra shifts
 *       added, and only at hours with room under their productivity-floor
 *       ceiling, prioritizing the hour with the most headroom — so total
 *       labor hours are an OUTPUT of the optimization (e.g. 248h/month if
 *       that's what's needed), never padded toward a guideline. Full-time
 *       is always exactly 8h, Part-time always 4-8h, both within
 *       09:00-22:00. Priorities 1-3 bypass the monthly/daily ceilings when
 *       truly necessary rather than silently leaving a gap — reported in
 *       `budgetShortfalls`, never silent. Per-employee weekly/monthly hour
 *       caps (employee.default_weekly_hours) are never exceeded, in any
 *       case. Always leaves the roster(s) in DRAFT status — never
 *       auto-approves or publishes. One Roster row is created/reused per
 *       ISO week (Monday-start) touched by the range; existing Roster rows
 *       and their status/approval history are preserved, only Shift rows in
 *       the requested date range are replaced. If shifts already exist in
 *       that range, the call fails with 409 unless `regenerate: true` is
 *       passed.
 *     tags: [Roster]
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
 *               regenerate:
 *                 type: boolean
 *                 default: false
 *                 description: Replace shifts already scheduled in this range instead of failing with 409
 *           example:
 *             storeId: '1005'
 *             startDate: '2026-08-24'
 *             endDate: '2026-08-30'
 *     responses:
 *       201:
 *         description: Draft roster generated
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
 *                         rosterIds: { type: array, items: { type: string, format: uuid } }
 *                         generatedShifts: { type: integer }
 *                         totalLaborHours: { type: number }
 *                         estimatedLaborCost: { type: number }
 *                         laborCostPercent: { type: number, nullable: true }
 *                         productivity: { type: number, nullable: true }
 *                         dailyLaborHoursBudget:
 *                           type: array
 *                           description: One entry per date a Sales/Budget tier actually matched
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               allowedLaborHours: { type: number }
 *                               salesLevel: { type: number }
 *                               salesLevelSource: { type: string, enum: [GROSS_BUDGET, FORECAST] }
 *                               tierSource: { type: string, enum: [STORE_TIER, GLOBAL_TIER] }
 *                               dayType: { type: string, enum: [WEEKDAY, WEEKEND], description: 'Saturday/Sunday = WEEKEND; determines whether weekday_labor_hours or weekend_labor_hours was used' }
 *                         budgetShortfalls:
 *                           type: array
 *                           description: Opening/closing coverage that could not fit within the daily labor-hour budget (coverage is still guaranteed — this is reported, never silently dropped)
 *                           items:
 *                             type: object
 *                             properties:
 *                               date: { type: string, format: date }
 *                               requiredHours: { type: number, nullable: true }
 *                               allowedHours: { type: number, nullable: true }
 *                               shortageHours: { type: number, nullable: true }
 *                               reason: { type: string }
 *                         warnings: { type: array, items: { type: string } }
 *                         validation: { type: object, description: 'Same shape as POST /roster/validate' }
 *             example:
 *               success: true
 *               message: Draft roster generated
 *               data:
 *                 storeId: '1005'
 *                 startDate: '2026-08-24'
 *                 endDate: '2026-08-30'
 *                 rosterIds: [f69dde10-f1b2-49e5-97ed-caac5809b7ca]
 *                 generatedShifts: 21
 *                 totalLaborHours: 147
 *                 estimatedLaborCost: 7350
 *                 laborCostPercent: 17.8
 *                 productivity: 489.5
 *                 warnings: []
 *                 validation:
 *                   status: OK
 *                   openingCoverageOk: true
 *                   closingCoverageOk: true
 *                   understaffedHours: []
 *                   overstaffedHours: []
 *                   employeesOverLimit: []
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       409:
 *         description: Shifts already exist in this range and regenerate was not set to true
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /roster/validate:
 *   post:
 *     summary: Validate an already-generated roster's coverage, staffing, and labor cost for a store/date range
 *     description: >
 *       PHASE 1F checklist, read-only: opening/closing coverage, per-hour
 *       understaffing/overstaffing vs. the forecast-derived requirement,
 *       employees over their monthly hour cap, labor cost % vs.
 *       target_col_percent, and productivity vs. target_productivity.
 *       status is FAILED if coverage is missing or any employee is over
 *       their cap, WARNING if there's under/overstaffing or labor cost
 *       exceeds target, else OK.
 *     tags: [Roster]
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
 *         description: Validation result
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 storeId: '1001'
 *                 startDate: '2026-08-24'
 *                 endDate: '2026-08-30'
 *                 status: WARNING
 *                 openingCoverageOk: true
 *                 closingCoverageOk: true
 *                 understaffedHours: []
 *                 overstaffedHours: ['2026-08-25 14:00']
 *                 employeesOverLimit: []
 *                 totalPlannedHours: 147
 *                 laborCost: 7350
 *                 salesForecastTotal: 41300
 *                 laborCostPercent: 17.8
 *                 targetLaborCostPercent: 15
 *                 productivity: 489.5
 *                 targetProductivity: 500
 *                 warnings: []
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /roster/actual-hours:
 *   post:
 *     summary: Record (or update) a store's actual labor hours for one date
 *     description: >
 *       PHASE 2: a store+date-level total, independent of any single shift
 *       (e.g. an event pushed a day to more hours than planned). Extends the
 *       existing per-shift actual-hours capability (PUT /labor) rather than
 *       replacing it — both coexist. Upserts on (storeId, date): recording
 *       the same date twice updates the figure rather than duplicating it.
 *       This is what feeds the rolling monthly capacity used by
 *       POST /roster/auto-generate and GET /roster/capacity — recording a
 *       higher-than-planned figure here reduces next week's available hours
 *       automatically.
 *     tags: [Roster]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, date, actualHours]
 *             properties:
 *               storeId: { type: string, example: '1005' }
 *               date: { type: string, format: date, example: '2026-08-28' }
 *               actualHours: { type: number, example: 68 }
 *           example:
 *             storeId: '1005'
 *             date: '2026-08-28'
 *             actualHours: 68
 *     responses:
 *       200:
 *         description: Actual hours recorded
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   get:
 *     summary: List a store's recorded actual labor hours over a date range
 *     tags: [Roster]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, example: '1005' }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Recorded actual hours
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /roster/capacity:
 *   get:
 *     summary: Rolling monthly labor-hour capacity for a store (Guideline / Used / Remaining / Monthly Sales)
 *     description: >
 *       PHASE 2 Section 3/7/13. Per day within the month, ACTUAL hours
 *       override PLANNED whenever recorded (store_actual_hours is the
 *       source of truth once entered); otherwise planned/committed hours
 *       count. remainingHours = monthlyGuideline - hoursUsedOrCommitted.
 *       null fields mean labor_guideline.monthly_labor_hours isn't
 *       configured for this store yet — no store-level cap is enforced in
 *       that case, matching how an unset target_productivity behaves today.
 *
 *       monthlySales (SUM of sales_report.gross_actual for the month) and
 *       monthlyGuidelineHours (that total mapped through the fixed Sales ->
 *       Monthly Labor Hours business table) are a SEPARATE, sales-derived
 *       planning ceiling — deliberately distinct from monthlyGuideline
 *       above (which comes from labor_guideline.monthly_labor_hours, a
 *       manually-configured per-store value). Neither is a target the
 *       roster generator tries to fill; both are informational ceilings.
 *       guidelineWithinRange is false (monthlyGuidelineHours null) when
 *       monthlySales falls outside the given table's 0-1,500,000 range —
 *       never guessed at by extrapolation.
 *     tags: [Roster]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, example: '1005' }
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: string, example: '2026-08' }
 *     responses:
 *       200:
 *         description: Monthly capacity
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 storeId: '1005'
 *                 monthKey: '2026-08'
 *                 monthlyGuideline: 1000
 *                 hoursUsedOrCommitted: 242
 *                 remainingHours: 758
 *                 monthlySales: 735000
 *                 monthlyGuidelineHours: 1140
 *                 guidelineWithinRange: true
 *                 byDate:
 *                   - { date: '2026-08-01', plannedHours: 40, actualHours: 40, variance: 0 }
 *                   - { date: '2026-08-07', plannedHours: 56, actualHours: 68, variance: 12 }
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/auto-generate', authenticate, authorize('schedule:generate'), storeScope, rosterController.autoGenerate);
router.post('/validate', authenticate, authorize('schedule:generate'), storeScope, rosterController.validate);
router.post('/actual-hours', authenticate, authorize('labor:input'), storeScope, rosterController.recordActualHours);
router.get('/actual-hours', authenticate, authorize('labor:view'), storeScope, rosterController.listActualHours);
router.get('/capacity', authenticate, authorize('labor:view'), storeScope, rosterController.capacity);
router.get('/', authenticate, authorize('schedule:generate'), storeScope, rosterController.list);
router.get('/:id', authenticate, rosterController.getOne);
router.put('/:id', authenticate, authorize('schedule:update'), rosterController.update);
router.delete('/:id', authenticate, authorize('schedule:delete'), rosterController.remove);

module.exports = router;
