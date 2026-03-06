const { getUserInfo } = require('../../services/kaschuso-api');
const { requireAuth } = require('./middleware/auth');
const { rejectCredentialQueryParams } = require('./middleware/validation');

var router = require('express').Router();

// returns the user info
router.get('/info/', rejectCredentialQueryParams, requireAuth, function(req, res, next) {
    const mandator = req.auth.mandator;
    const username = req.auth.username;
    const password = req.auth.password;
    getUserInfo(mandator, username, password).then(userInfo => {
        return res.json({ userInfo: userInfo });
    }).catch(next);
});

module.exports = router;
