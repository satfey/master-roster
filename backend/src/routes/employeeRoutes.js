const router = require('express').Router();
const employeeController = require('../controllers/employeeController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { storeScope } = require('../middleware/storeScope');
const { employeeScope } = require('../middleware/employeeScope');

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
 *     summary: Add an employee to a store (Staff Management)
 *     description: >
 *       Requires employee:manage (Admin; Store Manager for their own store — storeScope checks
 *       the body's storeId). employee.id has no generated default, so employeeId must be supplied.
 *       The ID is matched against existing employees IGNORING leading zeros, so "106922" and
 *       "00106922" are the same person: a previously removed employee of the same store is
 *       re-activated (200), any other match is 409. positionTimeType is required — the roster
 *       generator never schedules an employee without one. For bulk creation use POST /employee/import.
 *     tags: [Employee]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, storeId, firstName, positionTimeType]
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
 *               firstNameLocal:
 *                 type: string
 *                 nullable: true
 *               lastNameLocal:
 *                 type: string
 *                 nullable: true
 *               position:
 *                 type: string
 *                 nullable: true
 *               positionTimeType:
 *                 type: string
 *                 enum: ['Full time', 'Part time']
 *               defaultWeeklyHours:
 *                 type: number
 *                 nullable: true
 *                 description: 1-48. Omitted means the generator's default of 48.
 *           example:
 *             employeeId: '000123'
 *             storeId: '1005'
 *             firstName: Somchai
 *             lastName: Jaidee
 *             position: Service Staff
 *             positionTimeType: Part time
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
 *       200:
 *         description: A previously removed employee of the same store was re-activated.
 *       409:
 *         description: That Employee ID (ignoring leading zeros) already exists.
 *       400:
 *         description: employeeId, storeId, a name or positionTimeType missing or invalid.
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
 *     summary: Update an employee (partial — only the fields sent are written)
 *     description: >
 *       Requires employee:manage; employeeScope limits a Store Manager to their own store's
 *       employees. An unknown id is a 404. positionTimeType must be 'Full time' or 'Part time'.
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
 *     summary: Remove an employee
 *     description: >
 *       Deletes the row from the database. An employee who already has shifts cannot be deleted
 *       (shift.employee_id is ON DELETE RESTRICT, and deleting would destroy roster history), so
 *       they are deactivated instead. The response data says which happened —
 *       { id, deleted, deactivated, futureShiftCount } — so the caller can prompt a regenerate
 *       when future shifts remain.
 *     tags: [Employee]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: '000123' }
 *     responses:
 *       200:
 *         description: Employee deleted, or deactivated because it has roster history
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: Employee deleted
 *               data: { id: '000123', deleted: true, deactivated: false, futureShiftCount: 0 }
 *       404:
 *         description: Employee not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, storeScope, employeeController.list);
// POST carries storeId in the body, which storeScope already resolves. PUT/DELETE address an
// EMPLOYEE id, which storeScope would misread as a store id — see middleware/employeeScope.js.
router.post('/', authenticate, authorize('employee:manage'), storeScope, employeeController.create);
router.put('/:id', authenticate, authorize('employee:manage'), employeeScope, employeeController.update);
router.delete('/:id', authenticate, authorize('employee:manage'), employeeScope, employeeController.remove);

module.exports = router;
