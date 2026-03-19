require('dotenv').config();

var express = require('express'),
    bodyParser = require('body-parser'),
    cors = require('cors'),
    errorhandler = require('errorhandler'),
    morgan = require('morgan');

var { globalRateLimit } = require('./routes/api/middleware/rate-limit');

var isProduction = process.env.NODE_ENV === 'production';

function normalizeOrigin(origin) {
    return String(origin || '').trim().replace(/\/$/, '');
}

function getAllowedOrigins() {
    var configured = (process.env.FRONTEND_ORIGIN || '')
        .split(',')
        .map(function(origin) { return normalizeOrigin(origin); })
        .filter(Boolean);

    if (!isProduction && configured.length === 0) {
        return ['http://localhost:5173', 'http://127.0.0.1:5173'];
    }

    return configured;
}

// Create global app object
var app = express();

var allowedOrigins = getAllowedOrigins();

var corsOptions = {
    origin: function(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        var normalizedOrigin = normalizeOrigin(origin);
        if (allowedOrigins.indexOf(normalizedOrigin) !== -1) {
            return callback(null, true);
        }

        return callback(new Error('CORS origin not allowed: ' + normalizedOrigin));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(function(req, res, next) {
    // Baseline response headers for public API exposure.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Normal express config defaults
morgan.token('url', function (req, res) { 
    const url = req.originalUrl || req.url;
    return url.replace(/(\?|&)password=[^&]*/, '$1password=' + '\x1b[31m' + 'hidden' + '\x1b[0m'); // color 'hidden' as red
});
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(globalRateLimit);

app.use(require('method-override')());

// Simple health checks for container and platform probes.
app.get('/health', function(req, res) {
    return res.json({ status: 'ok' });
});

app.get('/api/health', function(req, res) {
    return res.json({ status: 'ok' });
});

if (!isProduction) {
    app.use(errorhandler());
}

require('./services/kaschuso-api');

app.use(require('./routes'));

/// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

/// error handlers

// development error handler
// will print stacktrace
if (!isProduction) {
    app.use(function(err, req, res, next) {
        console.log(err.stack);

        res.status(err.status || 500);

        res.json({'errors': {
            message: err.message,
            error: err
        }});
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.json({'errors': {
        message: isProduction ? 'Internal server error' : err.message,
        error: {}
    }});
});

// finally, let's start our server...
var server = app.listen( process.env.PORT || 3001, function(){
    console.log('Listening on port ' + server.address().port);
});
