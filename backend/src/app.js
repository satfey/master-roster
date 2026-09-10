require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./config/swagger');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Helmet's default CSP (script-src 'self', no 'unsafe-inline') blocks
// swagger-ui-express's inline bootstrap script, so /api-docs loads an empty
// shell that never renders. A single conditional call (rather than two
// stacked app.use(helmet()) calls) avoids the strict global CSP header
// being set right after the permissive one on the same request.
app.use((req, res, next) => (req.path.startsWith('/api-docs') ? helmet({ contentSecurityPolicy: false }) : helmet())(req, res, next));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Liveness check
 *     description: Not versioned under /api. Does not check DB connectivity — only that the process is up.
 *     tags: [Health]
 *     security: []
 *     servers:
 *       - url: /
 *         description: Root path (outside the /api base path)
 *     responses:
 *       200:
 *         description: Service is up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 timestamp: { type: string, format: date-time }
 *             example:
 *               status: ok
 *               timestamp: '2026-08-03T04:50:40.910Z'
 */
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// persistAuthorization: keeps the token entered via Authorize across page reloads,
// so testing an upload endpoint doesn't require re-authorizing every time.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { swaggerOptions: { persistAuthorization: true } }));
app.use('/api', routes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use(errorHandler);

module.exports = app;
