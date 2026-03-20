const { getUnconfirmedGrades } = require('../../services/kaschuso-api');
const { requireAuth } = require('./middleware/auth');
const { rejectCredentialQueryParams } = require('./middleware/validation');

var router = require('express').Router();

router.get('/', rejectCredentialQueryParams, requireAuth, function(req, res, next) {
    const mandator = req.auth.mandator;
    const username = req.auth.username;
    const password = req.auth.password;
    getUnconfirmedGrades(mandator, username, password).then(grades => {
        return res.json({
            mandator: mandator,
            username: username,
            grades: grades 
        });
    }).catch(next);
});

module.exports = router;
