require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { globalRateLimit } = require('./routes/api/middleware/rate-limit');
const { requireAuth } = require('./routes/api/middleware/auth');
const school = require('./services/kaschuso-api');

async function createApp() {
    const app = express();
    const isProduction = process.env.NODE_ENV === 'production';
    const allowed = (process.env.FRONTEND_ORIGIN || (!isProduction ? 'http://localhost:5173,http://127.0.0.1:5173' : ''))
        .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
    if (isProduction && !allowed.length) throw new Error('FRONTEND_ORIGIN must be set in production');
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use((req, res, next) => {
        res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
        if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
        if (isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        next();
    });
    app.get(['/health', '/api/health'], (_req, res) => res.json({ status: 'ok' }));
    app.get('/chatbot-setup.md', (_req, res) => {
        res.set({ 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' });
        res.sendFile(require('path').join(__dirname, 'docs/chatbot-setup.md'));
    });
    // OAuth and MCP own their parsers, authentication, CORS and rate limits.
    // They must not share the dashboard's global egress-IP budget.
    const { mountIntegration } = await import('./mcp/index.mjs');
    const integration = await mountIntegration(app, { school, requireDashboard: requireAuth });
    app.locals.closeMcp = integration.close;
    app.use(cors({
        origin(origin, callback) {
            if (!origin || allowed.includes(origin.replace(/\/$/, ''))) return callback(null, true);
            const error = new Error('Origin not allowed');
            error.status = 403;
            callback(error);
        },
        methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    // No query strings, route IDs, request bodies or credentials in access logs.
    app.use(morgan(':method :status :response-time ms'));
    app.use(express.json({ limit: '8kb' }));
    app.use(globalRateLimit);
    app.use(require('./routes'));
    app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
    app.use((error, _req, res, next) => {
        if (res.headersSent) return next(error);
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
        // Upstream errors can carry credentials, cookies and source HTML.
        res.status(status).json({ errors: { message: status === 503 ? 'Service temporarily unavailable' : 'Request could not be completed', error: {} } });
    });
    return app;
}

if (require.main === module) {
    createApp().then(app => {
        const server = app.listen(process.env.PORT || 3001, () => console.log('Listening on port ' + server.address().port));
        async function shutdown() {
            server.closeAllConnections();
            server.close();
            await app.locals.closeMcp();
        }
        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
    }).catch(() => { console.error('Startup configuration or dependency unavailable; check setup'); process.exitCode = 1; });
}

module.exports = { createApp };
