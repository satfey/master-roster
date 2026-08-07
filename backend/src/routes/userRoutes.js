const router = require('express').Router();
const userController = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

/**
 * @swagger
 * /user:
 *   get:
 *     summary: List all users (Admin only)
 *     description: Returns every user with its role and (if assigned) store embedded. No password field exists yet — login is deferred.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: List of users
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
 *                           - $ref: '#/components/schemas/User'
 *                           - type: object
 *                             properties:
 *                               role:
 *                                 $ref: '#/components/schemas/Role'
 *                               store:
 *                                 allOf:
 *                                   - $ref: '#/components/schemas/Store'
 *                                 nullable: true
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003
 *                   full_name: Bob Manager
 *                   email: manager1@test.com
 *                   role_id: 33333333-3333-3333-3333-333333333333
 *                   store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                   is_active: true
 *                   role: { id: 33333333-3333-3333-3333-333333333333, name: Store Manager, permissions: [MANAGE_STORE, ENTER_SALES, MANAGE_ROSTER] }
 *                   store: { id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1, name: Bangna Store, region: Bangkok, area_coach_id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002 }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   post:
 *     summary: Create a user (Admin only) — no password yet, see README
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, roleId]
 *             properties:
 *               fullName:
 *                 type: string
 *                 description: User's full name
 *               email:
 *                 type: string
 *                 format: email
 *               roleId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of an existing role
 *               storeId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Optional — assigns the user to a store (e.g. Store Manager)
 *           example:
 *             fullName: Jane Doe
 *             email: jane.doe@example.com
 *             roleId: 33333333-3333-3333-3333-333333333333
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *             example:
 *               success: true
 *               message: User created
 *               data:
 *                 id: 626dfa96-2f87-43f5-b644-43ba248f9eb4
 *                 full_name: Jane Doe
 *                 email: jane.doe@example.com
 *                 role_id: 33333333-3333-3333-3333-333333333333
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 is_active: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         description: >
 *           Includes constraint violations (e.g. duplicate email) — the
 *           controller does not pre-validate input, so DB errors surface here.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 * /user/{id}:
 *   put:
 *     summary: Update a user (Admin only)
 *     description: >
 *       Updating a non-existent id currently surfaces as a 500 (the query
 *       uses `.single()`, which errors on zero matching rows) rather than 404.
 *     tags: [User]
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
 *               fullName:
 *                 type: string
 *               roleId:
 *                 type: string
 *                 format: uuid
 *               storeId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *           example:
 *             fullName: Jane Doe
 *             roleId: 33333333-3333-3333-3333-333333333333
 *             storeId: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *             isActive: true
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *             example:
 *               success: true
 *               message: User updated
 *               data:
 *                 id: 626dfa96-2f87-43f5-b644-43ba248f9eb4
 *                 full_name: Jane Doe
 *                 email: jane.doe@example.com
 *                 role_id: 33333333-3333-3333-3333-333333333333
 *                 store_id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
 *                 is_active: true
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', authenticate, authorize('user:manage'), userController.list);
router.post('/', authenticate, authorize('user:manage'), userController.create);
router.put('/:id', authenticate, authorize('user:manage'), userController.update);

module.exports = router;
