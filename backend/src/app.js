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

const apiDocsEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true';

// Helmet's default CSP (script-src 'self', no 'unsafe-inline') blocks
// swagger-ui-express's inline bootstrap script, so /api-docs loads an empty
// shell that never renders. A single conditional call (rather than two
// stacked app.use(helmet()) calls) avoids the strict global CSP header
// being set right after the permissive one on the same request.
app.use((req, res, next) => (apiDocsEnabled && req.path.startsWith('/api-docs') ? helmet({ contentSecurityPolicy: false }) : helmet())(req, res, next));
// CORS_ORIGIN is required in production and must name the real frontend origin(s), comma
// separated. It used to fall back to '*' whenever the variable was unset, so a deploy that simply
// forgot to set it silently opened the API to every origin on the internet. Outside production the
// fallback stays, because local development runs the frontend on a different port.
const corsOrigin = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && corsOrigin.length === 0) {
  throw new Error('CORS_ORIGIN must be set in production — refusing to start with a wildcard CORS policy');
}
app.use(cors({ origin: corsOrigin.length ? corsOrigin : '*' }));
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

/**
 * Swagger UI is a development tool, not part of the product.
 *
 * It served unauthenticated on every deploy, handing anyone who found the URL a complete map of
 * the API: every route, every permission, every request/response schema and worked example. That
 * is reconnaissance an attacker would otherwise have to guess at, and none of it is needed by the
 * frontend, which talks to /api directly.
 *
 * It is therefore off in production unless ENABLE_API_DOCS is explicitly set — an opt-in, so
 * forgetting a variable leaves it closed rather than open. Note the relaxed CSP below applies only
 * while it is mounted.
 */
if (apiDocsEnabled) {
  // persistAuthorization: keeps the token entered via Authorize across page reloads,
  // so testing an upload endpoint doesn't require re-authorizing every time.
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { swaggerOptions: { persistAuthorization: true } }));
}
app.use('/api', routes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use(errorHandler);

module.exports = app;
