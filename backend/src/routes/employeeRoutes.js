const router = require('express').Router();
const employeeController = require('../controllers/employeeController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');

/**
 * @swagger
 * /employee:
 *   get:
 *     summary: List employees for a store
 *     description: >
 *       Returns only active employees (`is_active = true`) for the given
 *       store. For bulk create/update from an Employee Master Excel file,
 *       see POST /employee/import/preview and /employee/import instead —
 *       this endpoint is for simple one-off manual edits.
 *     tags: [Employee]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, example: '1005' }
 *         description: store.id — not a UUID
 *     responses:
 *       200:
 *         description: List of active employees
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Employee' }
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: '000123'
 *                   store_id: '1005'
 *                   first_name: Somchai
 *                   last_name: Jaidee
 *                   position: Cashier
 *                   is_active: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   post:
 *     summary: Create an employee (manual, single-record)
 *     description: >
 *       employee.id has no auto-generated default — it must be supplied
 *       explicitly, never invented. For bulk creation from a file, use
 *       POST /employee/import instead.
 *     tags: [Employee]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, storeId]
 *             properties:
 *               employeeId:
 *                 type: string
 *                 example: '000123'
 *                 description: Becomes employee.id directly — the canonical source Employee ID, never a generated UUID.
 *               storeId:
 *                 type: string
 *                 example: '1005'
 *               firstName:
 *                 type: string
 *                 nullable: true
 *               lastName:
 *                 type: string
 *                 nullable: true
 *               position:
 *                 type: string
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *                 default: true
 *           example:
 *             employeeId: '000123'
 *             storeId: '1005'
 *             firstName: Somchai
 *             lastName: Jaidee
 *             position: Cashier
 *             isActive: true
 *     responses:
 *       201:
 *         description: Employee created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Employee' }
 *             example:
 *               success: true
 *               message: Employee created
 *               data:
 *                 id: '000123'
 *                 store_id: '1005'
 *                 first_name: Somchai
 *                 last_name: Jaidee
 *                 position: Cashier
 *                 is_active: true
 *       400:
 *         description: employeeId or storeId missing.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'employeeId is required', errors: null }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 * /employee/{id}:
 *   put:
 *     summary: Update an employee
 *     description: >
 *       Updating a non-existent id currently surfaces as a 500 (the query
 *       uses `.single()`, which errors on zero matching rows) rather than 404.
 *     tags: [Employee]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: '000123' }
 *         description: employee.id — the Employee ID from the source file, not a UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               storeId:
 *                 type: string
 *                 example: '1005'
 *               firstName:
 *                 type: string
 *                 nullable: true
 *               lastName:
 *                 type: string
 *                 nullable: true
 *               position:
 *                 type: string
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *           example:
 *             storeId: '1005'
 *             firstName: Somchai
 *             lastName: Jaidee
 *             position: Cashier
 *             isActive: true
 *     responses:
 *       200:
 *         description: Employee updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Employee' }
 *             example:
 *               success: true
 *               message: Employee updated
 *               data:
 *                 id: '000123'
 *                 store_id: '1005'
 *                 first_name: Somchai
 *                 last_name: Jaidee
 *                 position: Cashier
 *                 is_active: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   delete:
 *     summary: Deactivate an employee (soft delete — sets is_active to false)
 *     tags: [Employee]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: '000123' }
 *     responses:
 *       200:
 *         description: Employee deactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: Employee deactivated
 *               data: null
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, storeScope, employeeController.list);
router.post('/', authenticate, authorize('employee:manage'), employeeController.create);
router.put('/:id', authenticate, authorize('employee:manage'), employeeController.update);
router.delete('/:id', authenticate, authorize('employee:manage'), employeeController.remove);

module.exports = router;
