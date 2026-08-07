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
 *     description: Returns only active employees (`is_active = true`) for the given store.
 *     tags: [Employee]
 *     parameters:
 *       - in: query
 *         name: storeId
 *         required: true
 *         schema: { type: string, format: uuid }
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
 *                 - id: cccccccc-cccc-cccc-cccc-cccccccc0001
 *                   store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                   full_name: สมชาย ใจดี
 *                   position: Cashier
 *                   hourly_rate: 120
 *                   is_active: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   post:
 *     summary: Create an employee
 *     tags: [Employee]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, fullName]
 *             properties:
 *               storeId:
 *                 type: string
 *                 format: uuid
 *               fullName:
 *                 type: string
 *               position:
 *                 type: string
 *                 nullable: true
 *               hourlyRate:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *                 default: true
 *           example:
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *             fullName: สมชาย ใจดี
 *             position: Cashier
 *             hourlyRate: 120
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
 *                 id: cccccccc-cccc-cccc-cccc-cccccccc0001
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 full_name: สมชาย ใจดี
 *                 position: Cashier
 *                 hourly_rate: 120
 *                 is_active: true
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
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               storeId:
 *                 type: string
 *                 format: uuid
 *               fullName:
 *                 type: string
 *               position:
 *                 type: string
 *                 nullable: true
 *               hourlyRate:
 *                 type: number
 *                 format: float
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *           example:
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *             fullName: สมชาย ใจดี
 *             position: Cashier
 *             hourlyRate: 125
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
 *                 id: cccccccc-cccc-cccc-cccc-cccccccc0001
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 full_name: สมชาย ใจดี
 *                 position: Cashier
 *                 hourly_rate: 125
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
 *         schema: { type: string, format: uuid }
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
