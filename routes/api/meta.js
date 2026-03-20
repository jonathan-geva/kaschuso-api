const { getPortalMetadata, getMandators } = require('../../services/kaschuso-api');

var router = require('express').Router();

router.get('/', async function(req, res, next) {
    try {
        const [metadata, mandators] = await Promise.all([
            Promise.resolve(getPortalMetadata()),
            getMandators()
        ]);

        return res.json({
            ...metadata,
            mandators: mandators
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
