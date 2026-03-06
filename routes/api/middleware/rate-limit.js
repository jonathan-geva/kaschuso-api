const WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const MAX_REQUESTS = Number(process.env.API_RATE_LIMIT_MAX || 120);
const AUTH_WINDOW_MS = Number(process.env.API_AUTH_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000);
const AUTH_MAX_REQUESTS = Number(process.env.API_AUTH_RATE_LIMIT_MAX || 10);

const REQUEST_COUNTER = new Map();

function keyFor(req, namespace) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return namespace + ':' + ip;
}

function trackAndCheck(key, windowMs, maxRequests) {
    const now = Date.now();
    const current = REQUEST_COUNTER.get(key);

    if (!current || current.resetAt <= now) {
        REQUEST_COUNTER.set(key, {
            count: 1,
            resetAt: now + windowMs
        });
        return true;
    }

    if (current.count >= maxRequests) {
        return false;
    }

    current.count += 1;
    REQUEST_COUNTER.set(key, current);
    return true;
}

function applyLimit(namespace, windowMs, maxRequests) {
    return function rateLimitMiddleware(req, res, next) {
        const key = keyFor(req, namespace);
        if (!trackAndCheck(key, windowMs, maxRequests)) {
            return res.status(429).json({
                error: 'RATE_LIMITED',
                detail: 'Too many requests. Try again later.'
            });
        }
        return next();
    };
}

const globalRateLimit = applyLimit('global', WINDOW_MS, MAX_REQUESTS);
const authRateLimit = applyLimit('auth', AUTH_WINDOW_MS, AUTH_MAX_REQUESTS);

module.exports = {
    globalRateLimit,
    authRateLimit
};
