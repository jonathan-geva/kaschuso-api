const { getGradeHistory } = require('../../services/kaschuso-api');
const { validateSemesterIds } = require('../../services/grade-history');
const { requireAuth } = require('./middleware/auth');
const { rejectCredentialQueryParams } = require('./middleware/validation');

const router = require('express').Router();

router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

router.get('/', rejectCredentialQueryParams, requireAuth, async (req, res) => {
    let options;
    try {
        if (Object.keys(req.query).some(key => key !== 'semesters')) throw new Error('Unsupported query');
        const semesters = req.query.semesters;
        if (semesters === undefined) options = {};
        else {
            if (typeof semesters !== 'string' || semesters.length > 103) throw new Error('Invalid semesters');
            options = { semesterIds: validateSemesterIds(semesters.split(',')) };
        }
    } catch {
        return res.status(400).json({ error: 'INVALID_SEMESTERS', detail: 'Select between one and eight available semesters.' });
    }
    try {
        const { mandator, username, password } = req.auth;
        return res.json(await getGradeHistory(mandator, username, password, options));
    } catch (error) {
        if (error.name === 'AuthenticationError') return res.status(401).json({ error: 'SCHOOL_SIGN_IN_REQUIRED', detail: 'Sign in to your school account again.' });
        if (error.code === 'INVALID_SEMESTERS') {
            return res.status(400).json({ error: 'INVALID_SEMESTERS', detail: 'Select between one and eight available semesters.' });
        }
        return res.status(502).json({ error: 'GRADE_HISTORY_UNAVAILABLE', detail: 'Grade history is unavailable.' });
    }
});

module.exports = router;
