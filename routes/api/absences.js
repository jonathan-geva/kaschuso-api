const { getAbsences } = require('../../services/kaschuso-api');
const { requireAuth } = require('./middleware/auth');
const { rejectCredentialQueryParams } = require('./middleware/validation');

var router = require('express').Router();

router.get('/', rejectCredentialQueryParams, requireAuth, function(req, res, next) {
    const mandator = req.auth.mandator;
    const username = req.auth.username;
    const password = req.auth.password;
    getAbsences(mandator, username, password).then(absencePayload => {
        const isArrayPayload = Array.isArray(absencePayload);
        const normalizedPayload = isArrayPayload
            ? { absences: absencePayload }
            : {
                absences: (absencePayload && Array.isArray(absencePayload.absences)) ? absencePayload.absences : [],
                ...absencePayload
            };

        return res.json({
            mandator: mandator,
            username: username,
            ...normalizedPayload
        });
    }).catch(next);
});

module.exports = router;
