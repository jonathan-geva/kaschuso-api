const { authenticate, getAuthenticationFailureInfo } = require('../../services/kaschuso-api');
const { authRateLimit } = require('./middleware/rate-limit');
const { createAuthSession } = require('./middleware/auth');
const { validateAuthBody } = require('./middleware/validation');

var router = require('express').Router();

// whether the user is authenticated
router.post('/', authRateLimit, validateAuthBody, function(req, res) {
    const mandator = req.body.mandator;
    const username = req.body.username;
    const password = req.body.password;

    authenticate(mandator, username, password).then(() => {
        const authSession = createAuthSession(mandator, username, password);
        return res.json({
            mandator: mandator,
            username: username,
            authenticated: true,
            token: authSession.token,
            expiresIn: authSession.expiresIn
        });
    }).catch((error) => {
        const failure = getAuthenticationFailureInfo(error);
        return res.status(401).json({
            mandator: mandator,
            username: username,
            authenticated: false,
            reason: failure.reason,
            detail: failure.detail
        });
    });
});

module.exports = router;
