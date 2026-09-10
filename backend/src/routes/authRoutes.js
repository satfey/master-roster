const router = require('express').Router();
const authController = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Authenticate with email + password and receive a JWT
 *     description: >
 *       Users, roles, and store/area-coach assignments are configured
 *       directly in the database — there is no registration endpoint.
 *       Returns the same "invalid email or password" message whether the
 *       email doesn't exist, the account has no password set, the account
 *       is deactivated, or the password is wrong, so a caller can never
 *       tell which one it was. The returned token carries only the user id;
 *       role/permissions/store are re-read from the database on every
 *       subsequent request (see `authenticate` middleware), so a role
 *       change or deactivation takes effect immediately, not after the
 *       token expires.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *           example:
 *             email: jane.doe@example.com
 *             password: hunter2
 *     responses:
 *       200:
 *         description: Login successful
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
 *                         token: { type: string, description: 'JWT — send as `Authorization: Bearer <token>` on subsequent requests.' }
 *                         user: { $ref: '#/components/schemas/Identity' }
 *             example:
 *               success: true
 *               message: Login successful
 *               data:
 *                 token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 user:
 *                   id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001
 *                   name: John Admin
 *                   email: admin@test.com
 *                   role: ADMIN
 *                   permissions: ['*']
 *                   storeId: null
 *                   areaStoreIds: []
 *       400:
 *         description: Missing email or password.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'email and password are required', errors: null }
 *       401:
 *         description: Invalid email or password (or the account is deactivated / has no password set).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *             example: { success: false, message: 'Invalid email or password', errors: null }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/login', authController.login);

/**
 * @swagger
 * /me:
 *   get:
 *     summary: Get the current identity
 *     description: >
 *       Returns the identity the `authenticate` middleware resolved from the
 *       request's bearer token — the same shape `POST /login` returns.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current identity
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Identity'
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001
 *                 name: John Admin
 *                 email: admin@test.com
 *                 role: ADMIN
 *                 permissions: ['*']
 *                 storeId: null
 *                 areaStoreIds: []
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/me', authenticate, authController.me);

module.exports = router;
