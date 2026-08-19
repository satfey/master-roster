const router = require('express').Router();
const storeController = require('../controllers/storeController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * @swagger
 * /store:
 *   get:
 *     summary: List stores visible to the current user
 *     description: Unrestricted for Admin/Executive; scoped to the caller's own store or assigned stores otherwise.
 *     tags: [Store]
 *     responses:
 *       200:
 *         description: List of stores
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Store' }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                   storeId: '1001'
 *                   name: Bangna Store
 *                   region: Bangkok
 *                   area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   post:
 *     summary: Create a store (Admin only)
 *     tags: [Store]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               region:
 *                 type: string
 *                 nullable: true
 *               areaCoachId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: ID of the user (Area Coach role) overseeing this store
 *           example:
 *             name: Bangna Store
 *             region: Bangkok
 *             areaCoachId: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *     responses:
 *       201:
 *         description: Store created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Store' }
 *             example:
 *               success: true
 *               message: Store created
 *               data:
 *                 id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 name: Bangna Store
 *                 region: Bangkok
 *                 area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /store/{id}:
 *   get:
 *     summary: Store dashboard — employees, labor guideline, area coach
 *     tags: [Store]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Store with embedded relations
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       allOf:
 *                         - $ref: '#/components/schemas/Store'
 *                         - type: object
 *                           properties:
 *                             employee:
 *                               type: array
 *                               items: { $ref: '#/components/schemas/Employee' }
 *                             labor_guideline:
 *                               type: array
 *                               items: { $ref: '#/components/schemas/LaborGuideline' }
 *                             area_coach:
 *                               allOf:
 *                                 - $ref: '#/components/schemas/User'
 *                               nullable: true
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 name: Bangna Store
 *                 region: Bangkok
 *                 area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *                 employee:
 *                   - id: cccccccc-cccc-cccc-cccc-cccccccc0001
 *                     store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     full_name: สมชาย ใจดี
 *                     position: Cashier
 *                     hourly_rate: 120
 *                     is_active: true
 *                 labor_guideline:
 *                   - id: 14141414-1414-1414-1414-141414141401
 *                     store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                     target_productivity: 1200
 *                     target_col_percent: 22
 *                     min_staff_per_shift: 3
 *                 area_coach:
 *                   id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *                   full_name: Alice Area Coach
 *                   email: coach@test.com
 *                   role_id: 22222222-2222-2222-2222-222222222222
 *                   store_id: null
 *                   is_active: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   put:
 *     summary: Update a store (Admin only)
 *     description: >
 *       Updating a non-existent id currently surfaces as a 500 (the query
 *       uses `.single()`, which errors on zero matching rows) rather than 404.
 *     tags: [Store]
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
 *               name:
 *                 type: string
 *               region:
 *                 type: string
 *                 nullable: true
 *               areaCoachId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *           example:
 *             name: Bangna Store
 *             region: Bangkok
 *             areaCoachId: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *     responses:
 *       200:
 *         description: Store updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Store' }
 *             example:
 *               success: true
 *               message: Store updated
 *               data:
 *                 id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 name: Bangna Store
 *                 region: Bangkok
 *                 area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /store/{id}/guideline:
 *   put:
 *     summary: Create or update a store's labor guideline
 *     description: Upserts by store id — creates the guideline row if none exists yet, otherwise updates the most recent one.
 *     tags: [Store]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Store ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetProductivity:
 *                 type: number
 *                 format: float
 *                 description: Target sales (THB) per labor hour
 *               targetColPercent:
 *                 type: number
 *                 format: float
 *                 description: Target cost-of-labor percentage
 *               minStaffPerShift:
 *                 type: number
 *                 format: float
 *           example:
 *             targetProductivity: 1200
 *             targetColPercent: 22
 *             minStaffPerShift: 3
 *     responses:
 *       200:
 *         description: Labor guideline created or updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/LaborGuideline' }
 *             example:
 *               success: true
 *               message: Labor guideline updated
 *               data:
 *                 id: 14141414-1414-1414-1414-141414141401
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 target_productivity: 1200
 *                 target_col_percent: 22
 *                 min_staff_per_shift: 3
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, storeController.list);
router.post('/', authenticate, authorize('branch:manage'), storeController.create);
router.get('/:id', authenticate, storeScope, storeController.getOne);
router.put('/:id', authenticate, authorize('branch:manage'), storeScope, storeController.update);
router.put('/:id/guideline', authenticate, authorize('branch:manage'), storeScope, storeController.upsertGuideline);

module.exports = router;
