const express = require('express');
const { requireAuth } = require('./middleware/auth');
const { rejectCredentialQueryParams } = require('./middleware/validation');

function createQualificationRouter({ school, engine } = {}) {
    school ||= require('../../services/kaschuso-api');
    engine ||= require('../../qualification');
    const router = express.Router();
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    router.get('/rules', (_req, res) => res.json(engine.getRules()));
    router.use(rejectCredentialQueryParams, requireAuth);
    async function calculate(req, res, next) {
        let scenario;
        try { scenario = engine.validateScenario(req.method === 'POST' ? req.body : {}); }
        catch { return res.status(400).json({ error: 'INVALID_SCENARIO' }); }
        try {
            const { mandator, username, password } = req.auth;
            const history = await school.getGradeHistory(mandator, username, password);
            return res.json(engine.buildQualification(history, scenario));
        } catch (error) {
            if (error.name === 'ValidationError') return res.status(400).json({ error: 'INVALID_SCENARIO' });
            next(error);
        }
    }
    router.get('/', calculate);
    router.post('/', calculate);
    return router;
}

module.exports = { createQualificationRouter };
