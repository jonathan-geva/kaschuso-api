const MANDATOR_REGEX = /^[a-zA-Z0-9-]{1,50}$/;

function hasCredentialQueryParams(req) {
    return req.query && (req.query.password || req.query.username || req.query.mandator);
}

function rejectCredentialQueryParams(req, res, next) {
    if (hasCredentialQueryParams(req)) {
        return res.status(400).json({
            error: 'BAD_REQUEST',
            detail: 'Credentials in query parameters are not supported. Use JSON request body for /api/authenticate.'
        });
    }
    return next();
}

function validateAuthBody(req, res, next) {
    const mandator = req.body && req.body.mandator;
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;

    if (!mandator || !MANDATOR_REGEX.test(mandator)) {
        return res.status(422).json({
            error: 'VALIDATION_ERROR',
            detail: 'mandator must be 1-50 chars and only contain letters, numbers, and dashes.'
        });
    }

    if (!username || typeof username !== 'string' || username.length > 255) {
        return res.status(422).json({
            error: 'VALIDATION_ERROR',
            detail: 'username is required and must be <= 255 chars.'
        });
    }

    if (!password || typeof password !== 'string' || password.length > 255) {
        return res.status(422).json({
            error: 'VALIDATION_ERROR',
            detail: 'password is required and must be <= 255 chars.'
        });
    }

    return next();
}

module.exports = {
    rejectCredentialQueryParams,
    validateAuthBody
};
