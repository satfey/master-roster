const router = require('express').Router();
const authController = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');

/**
 * @swagger
 * /login:
 *   post:
 *     summary: (Not implemented yet) Authenticate and receive a JWT
 *     description: >
 *       Real login is deferred (see README) — this endpoint currently always
 *       responds `501 Not Implemented`. Documented here with its intended
 *       request shape so the contract is ready once login is built.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       description: Intended shape once login is implemented.
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
 *       501:
 *         description: Always returned today — login is not implemented yet.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *             example:
 *               success: false
 *               message: Login is not implemented yet — the app currently runs without authentication. See README.
 *               errors: null
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
 *       Returns the identity attached to the request by the `authenticate`
 *       middleware. Currently always a fixed system identity (real per-user
 *       login is deferred — see README), but this is the intended shape of
 *       the authenticated caller once JWT login lands.
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
