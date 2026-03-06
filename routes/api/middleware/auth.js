const jwt = require('jsonwebtoken');

const SESSION_TTL_SECONDS = Number(process.env.API_SESSION_TTL_SECONDS || 900);
const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_STORE = new Map();

if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
}

function getJwtSecret() {
    return JWT_SECRET || 'dev-only-insecure-secret';
}

function buildSessionKey(mandator, username) {
    return mandator + ':' + username;
}

function cleanupExpiredSessions() {
    const now = Date.now();
    SESSION_STORE.forEach((value, key) => {
        if (!value || value.expiresAt <= now) {
            SESSION_STORE.delete(key);
        }
    });
}

function createAuthSession(mandator, username, password) {
    cleanupExpiredSessions();

    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    const sessionKey = buildSessionKey(mandator, username);

    SESSION_STORE.set(sessionKey, {
        mandator: mandator,
        username: username,
        password: password,
        expiresAt: expiresAt
    });

    const token = jwt.sign(
        {
            sub: username,
            mandator: mandator,
            sessionKey: sessionKey
        },
        getJwtSecret(),
        { expiresIn: SESSION_TTL_SECONDS }
    );

    return {
        token: token,
        expiresIn: SESSION_TTL_SECONDS,
        sessionKey: sessionKey
    };
}

function getSessionByToken(token) {
    cleanupExpiredSessions();

    let payload;
    try {
        payload = jwt.verify(token, getJwtSecret());
    } catch (error) {
        return undefined;
    }

    const session = payload && payload.sessionKey ? SESSION_STORE.get(payload.sessionKey) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
        if (payload && payload.sessionKey) {
            SESSION_STORE.delete(payload.sessionKey);
        }
        return undefined;
    }

    return {
        mandator: session.mandator,
        username: session.username,
        password: session.password,
        sessionKey: payload.sessionKey
    };
}

function requireAuth(req, res, next) {
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
        return res.status(401).json({
            error: 'UNAUTHORIZED',
            detail: 'Missing bearer token.'
        });
    }

    const session = getSessionByToken(match[1]);
    if (!session) {
        return res.status(401).json({
            error: 'UNAUTHORIZED',
            detail: 'Invalid or expired token.'
        });
    }

    req.auth = session;
    return next();
}

module.exports = {
    createAuthSession,
    requireAuth
};
