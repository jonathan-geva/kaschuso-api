const { createAuthSession, requireAuth } = require('./auth');
const { authRateLimit } = require('./rate-limit');
const { validateAuthBody, rejectCredentialQueryParams } = require('./validation');

function createMockRes() {
    const res = {
        statusCode: 200,
        payload: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.payload = data;
            return this;
        }
    };
    return res;
}

describe('auth middleware', () => {
    test('requireAuth allows request with valid bearer token', () => {
        const session = createAuthSession('gibsso', 'student', 'secret');
        const req = { headers: { authorization: 'Bearer ' + session.token } };
        const res = createMockRes();
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.auth).toBeDefined();
        expect(req.auth.username).toBe('student');
        expect(res.statusCode).toBe(200);
    });

    test('requireAuth rejects missing bearer token', () => {
        const req = { headers: {} };
        const res = createMockRes();
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.payload.error).toBe('UNAUTHORIZED');
    });

    test('requireAuth rejects invalid bearer token', () => {
        const req = { headers: { authorization: 'Bearer invalid-token' } };
        const res = createMockRes();
        const next = jest.fn();

        requireAuth(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.payload.error).toBe('UNAUTHORIZED');
    });
});

describe('validation middleware', () => {
    test('validateAuthBody accepts valid input', () => {
        const req = {
            body: {
                mandator: 'gibsso',
                username: 'student',
                password: 'secret'
            }
        };
        const res = createMockRes();
        const next = jest.fn();

        validateAuthBody(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
    });

    test('validateAuthBody rejects invalid mandator', () => {
        const req = {
            body: {
                mandator: '../bad',
                username: 'student',
                password: 'secret'
            }
        };
        const res = createMockRes();
        const next = jest.fn();

        validateAuthBody(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(422);
        expect(res.payload.error).toBe('VALIDATION_ERROR');
    });

    test('rejectCredentialQueryParams blocks credential query usage', () => {
        const req = {
            query: {
                mandator: 'gibsso',
                username: 'student',
                password: 'secret'
            }
        };
        const res = createMockRes();
        const next = jest.fn();

        rejectCredentialQueryParams(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.payload.error).toBe('BAD_REQUEST');
    });
});

describe('rate limit middleware', () => {
    test('authRateLimit throttles repeated requests from same IP', () => {
        const res = createMockRes();
        const req = {
            ip: '203.0.113.10',
            connection: { remoteAddress: '203.0.113.10' }
        };

        const next = jest.fn();

        for (let i = 0; i < 10; i += 1) {
            authRateLimit(req, res, next);
        }

        expect(next).toHaveBeenCalledTimes(10);

        const blockedRes = createMockRes();
        const blockedNext = jest.fn();
        authRateLimit(req, blockedRes, blockedNext);

        expect(blockedNext).not.toHaveBeenCalled();
        expect(blockedRes.statusCode).toBe(429);
        expect(blockedRes.payload.error).toBe('RATE_LIMITED');
    });
});
