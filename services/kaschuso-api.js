const cryptoRandomString = require('crypto-random-string');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const axios = require('axios').default;
axios.defaults.withCredentials = true;

const qs = require('qs');
const cheerio = require('cheerio');

const LEGACY_BASE_URL = process.env.KASCHUSO_BASE_URL || 'https://kaschuso.so.ch/';
const SAL_BASE_URL = process.env.SAL_BASE_URL || 'https://portal.sbl.ch/';
const ENABLE_SAL_PORTAL = String(process.env.ENABLE_SAL_PORTAL || 'true').toLowerCase() !== 'false';
const SAL_DEBUG = String(process.env.SAL_DEBUG || 'false').toLowerCase() === 'true';
const SAL_USE_RESOURCE_INFO = String(process.env.SAL_USE_RESOURCE_INFO || 'false').toLowerCase() === 'true';
const SAL_TRY_REWRITTEN_LAUNCH = String(process.env.SAL_TRY_REWRITTEN_LAUNCH || 'false').toLowerCase() === 'true';
const ROBOTS_URL = LEGACY_BASE_URL + 'robots.txt';

function buildAuthEndpoints(baseUrl) {
    const origin = new URL(baseUrl).origin;
    return {
        formUrl: baseUrl + 'login/sls/auth?RequestedPage=%2f',
        loginUrl: baseUrl + 'login/sls/',
        sesJsUrl: baseUrl + 'sil-bid-check/ses.js',
        origin: origin
    };
}

function getBaseUrlForMandator(mandator) {
    const normalized = normalizeMandatorName(mandator);
    if (ENABLE_SAL_PORTAL && normalized === 'gymli') {
        return SAL_BASE_URL;
    }
    return LEGACY_BASE_URL;
}

function buildMandatorUrl(mandator) {
    return getBaseUrlForMandator(mandator) + mandator;
}

function isSalMandator(mandator) {
    return getBaseUrlForMandator(mandator) === SAL_BASE_URL;
}

const MANDATOR_ALIASES = {
    kbssogr: 'kbsso'
};

const KNOWN_MANDATORS = [
    {
        name: 'bzwh',
        description: 'Bildungszentrum Wallierhof',
        url: buildMandatorUrl('bzwh')
    },
    {
        name: 'ebzol',
        description: 'Erwachsenenbildungszentrum Olten',
        url: buildMandatorUrl('ebzol')
    },
    {
        name: 'ebzso',
        description: 'Erwachsenenbildungszentrum Solothurn',
        url: buildMandatorUrl('ebzso')
    },
    {
        name: 'gibsgr',
        description: 'Gewerblich-industrielle Berufsfachschule Grenchen',
        url: buildMandatorUrl('gibsgr')
    },
    {
        name: 'gibsol',
        description: 'Gewerblich-industrielle Berufsfachschule Olten',
        url: buildMandatorUrl('gibsol')
    },
    {
        name: 'gibsso',
        description: 'Gewerblich-industrielle Berufsfachschule Solothurn',
        url: buildMandatorUrl('gibsso')
    },
    {
        name: 'hfpo',
        description: 'Hoehere Fachschule Pflege Olten',
        url: buildMandatorUrl('hfpo')
    },
    {
        name: 'kbsol',
        description: 'Kaufmaennische Berufsfachschule Olten',
        url: buildMandatorUrl('kbsol')
    },
    {
        name: 'kbsso',
        description: 'Kaufmaennische Berufsfachschule Solothurn',
        url: buildMandatorUrl('kbsso')
    },
    {
        name: 'ksol',
        description: 'Kantonsschule Olten',
        url: buildMandatorUrl('ksol')
    },
    {
        name: 'ksso',
        description: 'Kantonsschule Solothurn',
        url: buildMandatorUrl('ksso')
    },
    {
        name: 'gymli',
        description: 'Gymnasium Liestal',
        url: buildMandatorUrl('gymli')
    }
];

function isMandatorEnabled(mandatorName) {
    const normalized = normalizeMandatorName(mandatorName);
    if (normalized === 'gymli') {
        return ENABLE_SAL_PORTAL;
    }
    return true;
}

function getEnabledKnownMandators() {
    return KNOWN_MANDATORS.filter(mandator => isMandatorEnabled(mandator.name));
}


const GRADES_PAGE_ID   = 21311;
const ABSENCES_PAGE_ID = 21111;
const SETTINGS_PAGE_ID = 22500;
const SAL_WEBTOP_URL = '/vdesk/webtop.eui?webtop=/Common/schulportal_wt&webtop_type=webtop_full';
const SAL_RESOURCE_LIST_URL = '/vdesk/resource_list.xml?resourcetype=res';
const SAL_RESOURCE_INFO_URL = '/vdesk/resource_info_v2.xml';
const SAL_COOKIE_JAR_RAW_KEY = '__salCookieJarRaw';

const SES_PARAM_REGEX = /var\s+bid\s*=\s*getBid\(['\"]([^'\"]+?)['\"]\)/;

const DEFAULT_HEADERS = {
    // Keep this header set minimal: kaschuso currently blocks some legacy/fingerprinting headers.
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

var cookiesMap = [];

/**
 * Returns the first cookie that is essential to make *any* request.
 */
async function basicAuthenticate() {
    const baseUrl = arguments[0] || LEGACY_BASE_URL;
    const bootstrapUrl = baseUrl === SAL_BASE_URL
        ? baseUrl + 'my.policy'
        : baseUrl;

    return axios.get(bootstrapUrl, {
            withCredentials: true,
            headers: DEFAULT_HEADERS,
            maxRedirects: 0
        }).then(res => {
            return res.cookies;
        });
}

function mergeCookies() {
    return Object.assign({}, ...Array.from(arguments).filter(Boolean));
}

async function authenticate(mandator, username, password) {
    console.log('Authenticating: ' + username);

    if (isSalMandator(mandator)) {
        return authenticateViaSalPortal(mandator, username, password);
    }

    const baseUrl = getBaseUrlForMandator(mandator);
    const authEndpoints = buildAuthEndpoints(baseUrl);

    // set basic cookies to request login page
    var cookies = await basicAuthenticate(baseUrl);

    let headers = Object.assign({}, DEFAULT_HEADERS);
    headers['Cookie'] = toCookieHeaderString(cookies);

    // Legacy KASCHUSO typically expects RequestedPage=%2f{mandator}, while SAL portals
    // may serve the login form at RequestedPage=%2f without mandator in the query.
    let resolvedFormUrl = authEndpoints.formUrl + mandator;
    let formRes;
    let sesJS;

    try {
        [formRes, sesJS] = await Promise.all([
            axios.get(resolvedFormUrl, {
                withCredentials: true,
                headers: headers,
                maxRedirects: 5
            }),
            axios.get(authEndpoints.sesJsUrl, {
                withCredentials: true,
                headers: headers,
                maxRedirects: 5
            })
        ]);
    } catch (error) {
        const shouldRetryWithoutMandator =
            error &&
            error.response &&
            error.response.status === 404 &&
            getBaseUrlForMandator(mandator) === SAL_BASE_URL;

        if (!shouldRetryWithoutMandator) {
            throw error;
        }

        resolvedFormUrl = authEndpoints.formUrl;
        [formRes, sesJS] = await Promise.all([
            axios.get(resolvedFormUrl, {
                withCredentials: true,
                headers: headers,
                maxRedirects: 5
            }),
            axios.get(authEndpoints.sesJsUrl, {
                withCredentials: true,
                headers: headers,
                maxRedirects: 5
            })
        ]);
    }

    cookies = mergeCookies(cookies, formRes.cookies, sesJS.cookies);
    headers['Cookie'] = toCookieHeaderString(cookies);

    let loginHeaders = Object.assign({}, headers);
    loginHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    loginHeaders['Origin'] = authEndpoints.origin;
    loginHeaders['Referer'] = resolvedFormUrl;

    // make login
    const loginPayload = getLoginPayloadFromHtml(formRes.data, username, password);

    const loginRes = await axios.post(authEndpoints.loginUrl + getActionFromSesJs(sesJS.data), 
        qs.stringify(loginPayload),
        {
            withCredentials: true,
            headers: loginHeaders,
            maxRedirects: 0
        }
    );
    
    if (!hasAuthenticatedSessionCookie(loginRes.cookies)) {
        const error =  new Error('upstream login did not yield an authenticated session');
        error.name = 'AuthenticationError';
        error.authDiagnostics = buildAuthenticationDiagnostics(loginRes);
        console.warn('Authentication rejected by upstream', error.authDiagnostics);
        throw error;
    }
    
    cookies = mergeCookies(cookies, loginRes.cookies);
    
    storeCookies(mandator, username, cookies);

    return cookies;
}

async function authenticateViaSalPortal(mandator, username, password) {
    try {
        const curlCookies = authenticateViaSalPortalWithCurl(username, password);
        storeCookies(mandator, username, curlCookies);
        return curlCookies;
    } catch (curlError) {
        console.warn('SAL curl fallback unavailable or failed, falling back to axios flow', {
            message: curlError && curlError.message,
            code: curlError && curlError.code
        });
    }

    const baseUrl = getBaseUrlForMandator(mandator);

    for (let attempt = 0; attempt < 2; attempt++) {
        // Clear potentially stale BIG-IP sessions before starting a new login flow.
        let cookies = {};
        const hangupFlow = await requestWithRedirectCookieCapture({
            method: 'get',
            url: baseUrl + 'vdesk/hangup.php3',
            headers: DEFAULT_HEADERS,
            cookies: cookies,
            maxHops: 5
        });

        cookies = mergeCookies(cookies, hangupFlow.cookies);

        let headers = Object.assign({}, DEFAULT_HEADERS);
        headers['Cookie'] = toCookieHeaderString(cookies);

        // Bootstrap the modern login flow and preserve redirect-issued cookies.
        const loginPageFlow = await requestWithRedirectCookieCapture({
            method: 'get',
            url: baseUrl + 'my.policy',
            headers: headers,
            cookies: cookies,
            maxHops: 5
        });

        cookies = mergeCookies(cookies, loginPageFlow.cookies);
        headers['Cookie'] = toCookieHeaderString(cookies);

        const loginHeaders = Object.assign({}, headers, {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': new URL(baseUrl).origin,
            'Referer': baseUrl + 'my.policy'
        });

        const loginRes = await axios.post(baseUrl + 'my.policy',
            qs.stringify({
                username: username,
                password: password
            }),
            {
                withCredentials: true,
                headers: loginHeaders,
                maxRedirects: 0
            }
        );

        const location = (loginRes && loginRes.locationValue) || '';
        const appearsAuthenticated = Boolean(location && /\/saml\/idp\/res\?id=/.test(location));

        if (appearsAuthenticated) {
            cookies = mergeCookies(cookies, loginRes.cookies);
            storeCookies(mandator, username, cookies);
            return cookies;
        }

        const shouldRetryFreshSession = attempt === 0 && /\/my\.logout\.php3\?errorcode=19/.test(location);
        if (shouldRetryFreshSession) {
            continue;
        }

        const error = new Error('SAL portal login did not yield expected SAML redirect');
        error.name = 'AuthenticationError';
        error.authDiagnostics = buildAuthenticationDiagnostics(loginRes);
        console.warn('SAL authentication rejected by upstream', error.authDiagnostics);
        throw error;
    }

    const exhaustedError = new Error('SAL portal login retry attempts exhausted');
    exhaustedError.name = 'AuthenticationError';
    throw exhaustedError;
}

function runCurl(args) {
    const normalizedArgs = Array.isArray(args) ? args.slice() : [];
    if (!normalizedArgs.includes('--connect-timeout')) {
        normalizedArgs.unshift('8');
        normalizedArgs.unshift('--connect-timeout');
    }
    if (!normalizedArgs.includes('--max-time')) {
        normalizedArgs.unshift('15');
        normalizedArgs.unshift('--max-time');
    }
    if (!normalizedArgs.includes('-A') && !normalizedArgs.includes('--user-agent')) {
        normalizedArgs.unshift(DEFAULT_HEADERS['User-Agent']);
        normalizedArgs.unshift('-A');
    }

    return spawnSync('curl', normalizedArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function parseCookieJar(cookieJarPath) {
    const cookies = {};
    const raw = fs.readFileSync(cookieJarPath, 'utf8');
    cookies[SAL_COOKIE_JAR_RAW_KEY] = raw;

    raw.split(/\r?\n/).forEach(line => {
        if (!line || line.startsWith('#') && !line.startsWith('#HttpOnly_')) {
            return;
        }

        const normalized = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
        const parts = normalized.split(/\t+/);
        if (parts.length < 7) {
            return;
        }

        const name = parts[5];
        const value = parts[6];
        if (!name) {
            return;
        }

        cookies[name] = value;
    });

    return cookies;
}

function writeCookieJar(cookieJarPath, cookies, baseUrl) {
    const rawCookieJar = cookies && cookies[SAL_COOKIE_JAR_RAW_KEY];
    if (typeof rawCookieJar === 'string' && rawCookieJar.trim()) {
        fs.writeFileSync(cookieJarPath, rawCookieJar, 'utf8');
        return;
    }

    const domain = new URL(baseUrl || SAL_BASE_URL).hostname;
    const lines = [
        '# Netscape HTTP Cookie File'
    ];

    Object.entries(cookies || {}).forEach(([name, value]) => {
        if (name === SAL_COOKIE_JAR_RAW_KEY) {
            return;
        }
        if (!name) {
            return;
        }

        lines.push([domain, 'TRUE', '/', 'FALSE', '0', name, value || ''].join('\t'));
    });

    fs.writeFileSync(cookieJarPath, lines.join('\n') + '\n', 'utf8');
}

function fetchPageViaCurl(url, cookies, options) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaschuso-sal-page-'));
    const cookieJarPath = path.join(tempDir, 'cookies.txt');
    const headersPath = path.join(tempDir, 'headers.txt');
    const bodyPath = path.join(tempDir, 'body.html');

    try {
        writeCookieJar(cookieJarPath, cookies || {}, url);

        const args = [
            '-sS',
            '-L',
            '-b', cookieJarPath,
            '-c', cookieJarPath,
            '-D', headersPath,
            '-o', bodyPath
        ];

        if (options && options.referer) {
            args.push('-H', 'Referer: ' + options.referer);
        }
        if (options && options.headers) {
            Object.entries(options.headers).forEach(([key, value]) => {
                args.push('-H', `${key}: ${value}`);
            });
        }

        args.push(url);

        const result = runCurl(args);
        if (result.status !== 0) {
            throw new Error('curl protected page fetch failed: ' + (result.stderr || result.stdout || 'unknown error'));
        }

        const body = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf8') : '';
        const mergedCookies = parseCookieJar(cookieJarPath);

        return {
            data: String(body || ''),
            cookies: mergedCookies
        };
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup only.
        }
    }
}

function authenticateViaSalPortalWithCurl(username, password) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaschuso-sal-auth-'));
    const cookieJarPath = path.join(tempDir, 'cookies.txt');
    const headersPath = path.join(tempDir, 'headers.txt');

    try {
        let result = runCurl([
            '-sS',
            '-L',
            '-c', cookieJarPath,
            SAL_BASE_URL + 'vdesk/hangup.php3'
        ]);

        if (result.status !== 0) {
            throw new Error('curl hangup failed: ' + (result.stderr || result.stdout || 'unknown error'));
        }

        result = runCurl([
            '-sS',
            '-L',
            '-b', cookieJarPath,
            '-c', cookieJarPath,
            SAL_BASE_URL + 'my.policy'
        ]);

        if (result.status !== 0) {
            throw new Error('curl login bootstrap failed: ' + (result.stderr || result.stdout || 'unknown error'));
        }

        result = runCurl([
            '-sS',
            '-D', headersPath,
            '-o', '/dev/null',
            '-b', cookieJarPath,
            '-c', cookieJarPath,
            '-H', 'Content-Type: application/x-www-form-urlencoded',
            '--data-urlencode', 'username=' + username,
            '--data-urlencode', 'password=' + password,
            SAL_BASE_URL + 'my.policy'
        ]);

        if (result.status !== 0) {
            throw new Error('curl login submit failed: ' + (result.stderr || result.stdout || 'unknown error'));
        }

        const headers = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, 'utf8') : '';
        const locationMatch = headers.match(/^Location:\s*(.+)$/im);
        const locationValue = locationMatch ? locationMatch[1].trim() : '';
        const appearsAuthenticated = /\/saml\/idp\/res\?id=/.test(locationValue);

        if (!appearsAuthenticated) {
            const cookies = parseCookieJar(cookieJarPath);
            const error = new Error('SAL curl login did not yield expected SAML redirect');
            error.name = 'AuthenticationError';
            error.authDiagnostics = {
                status: (headers.match(/^HTTP\/[^\s]+\s+(\d{3})/m) || [])[1] || null,
                hasLocationHeader: Boolean(locationValue),
                locationValue: locationValue || null,
                cookieNames: Object.keys(cookies)
            };
            throw error;
        }

        // Continue the authenticated flow by following the redirect chain from the
        // first successful login response. Re-posting credentials can restart/poison
        // policy evaluation on some F5 setups.
        const redirectUrl = new URL(locationValue, SAL_BASE_URL).toString();
        result = runCurl([
            '-sS',
            '-L',
            '-b', cookieJarPath,
            '-c', cookieJarPath,
            redirectUrl
        ]);

        if (result.status !== 0) {
            throw new Error('curl login redirect follow failed: ' + (result.stderr || result.stdout || 'unknown error'));
        }

        if (SAL_DEBUG) {
            const debugFile = path.join(os.tmpdir(), `kaschuso-sal-auth-final.html`);
            fs.writeFileSync(debugFile, result.stdout || '', 'utf8');
            console.warn('SAL debug: Auth final page dumped to', debugFile);
        }

        const cookies = parseCookieJar(cookieJarPath);

        return cookies;
    } finally {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup only.
        }
    }
}

function getAuthenticationFailureInfo(error) {
    if (error && error.name === 'AuthenticationError') {
        if (error.authDiagnostics && (error.authDiagnostics.hasLocationHeader || error.authDiagnostics.hasCredentialError)) {
            return {
                reason: 'INVALID_CREDENTIALS',
                detail: 'The upstream login did not accept the provided credentials.'
            };
        }

        return {
            reason: 'UPSTREAM_RESPONSE_CHANGED',
            detail: 'The upstream login did not return a valid authenticated session.'
        };
    }

    if (error && error.code === 'ECONNABORTED') {
        return {
            reason: 'UPSTREAM_TIMEOUT',
            detail: 'The upstream login service did not respond in time.'
        };
    }

    if (error && error.response && error.response.status) {
        if (error.response.status === 403) {
            return {
                reason: 'UPSTREAM_FORBIDDEN',
                detail: 'The upstream login service rejected the request.'
            };
        }

        if (error.response.status >= 500) {
            return {
                reason: 'UPSTREAM_UNAVAILABLE',
                detail: 'The upstream login service is currently unavailable.'
            };
        }
    }

    if (error && error.code && /^E(?:AI_AGAIN|HOSTUNREACH|NETUNREACH|CONNREFUSED|CONNRESET|PIPE)$/.test(error.code)) {
        return {
            reason: 'NETWORK_ERROR',
            detail: 'A network error occurred while contacting the upstream login service.'
        };
    }

    if (error && error.name === 'TypeError') {
        return {
            reason: 'UPSTREAM_RESPONSE_CHANGED',
            detail: 'The upstream login page format could not be parsed.'
        };
    }

    return {
        reason: 'AUTHENTICATION_FAILED',
        detail: 'Authentication failed for an unknown reason.'
    };
}

function getCurrentRequestedPageFromHtml(html) {
    return cheerio.load(html)('input[name=currentRequestedPage]').attr('value');
}

function getLoginPayloadFromHtml(html, username, password) {
    const $ = cheerio.load(html);
    const payload = {};

    $('form[name=LoginForm] input[name]').each((_, element) => {
        const input = $(element);
        const name = input.attr('name');
        if (!name) {
            return;
        }
        payload[name] = input.attr('value') || '';
    });

    payload.userid = username;
    payload.password = password;

    return payload;
}

function getActionFromSesJs(html) {
    const match = String(html || '').match(SES_PARAM_REGEX);
    if (!match || !match[1]) {
        throw new TypeError('Could not parse BID token from ses.js');
    }

    const param = match[1];
    return 'auth?' + param + '=' + cryptoRandomString({ length: 32, type: 'hex' });
}

async function getUserInfo(mandator, username, password) {
    console.log('Getting user info for: ' + username);

    const { headers, homeData, cookies } = await getHomepageAndHeaders(mandator, username, password);
    const settingsUrl = findUrlByPageid(mandator, homeData, SETTINGS_PAGE_ID);
    const settingsPage = await getProtectedPageForMandator(mandator, settingsUrl, cookies, headers);

    if (settingsPage.cookies) {
        storeCookies(mandator, username, settingsPage.cookies);
    }

    return await getUserInfoFromHtml(homeData, settingsPage.data, mandator, username);
}

async function getUserInfoFromHtml(homeHtml, settingsHtml, mandator, username) {
    const $home = cheerio.load(homeHtml);
    const infos = {};
    await Promise.all($home('#content-card > div > div > table')
        .find('tbody > tr')
        .toArray()
        .map(async x => {
            const row = $home(x)
                .find('td')
                .toArray()
                .map(x => $home(x).text().replace(/\s+/g, ' ').trim());

            if (row.length >= 2 && row[0]) {
                infos[row[0]] = row[1] || '';
            }
        }));

    const $settings = cheerio.load(settingsHtml);

    const email = $settings('#f0').attr('value');
    const privateEmail = $settings('#f1').attr('value');

    const getInfoByAliases = (...aliases) => {
        for (const alias of aliases) {
            if (Object.prototype.hasOwnProperty.call(infos, alias) && infos[alias]) {
                return infos[alias];
            }
        }
        for (const alias of aliases) {
            if (Object.prototype.hasOwnProperty.call(infos, alias)) {
                return infos[alias];
            }
        }
        return undefined;
    };

    return {
        mandator: mandator,
        username: username,
        name: getInfoByAliases('Name', 'Name Vorname'),
        address: getInfoByAliases('Adresse', 'Strasse'),
        zipCity: getInfoByAliases('Ort', 'PLZ Ort'),
        birthdate: infos['Geburtsdatum'],
        education: getInfoByAliases('Ausbildungsgang', 'Profil'),
        hometown: infos['Heimatort'],
        phone: infos['Telefon'],
        mobile: infos['Mobiltelefon'],
        email: email,
        privateEmail: privateEmail,
    };
}

async function getGrades(mandator, username, password) {
    console.log('Getting grades for: ' + username);
    
    const { headers, homeData, cookies } = await getHomepageAndHeaders(mandator, username, password);
    const gradesUrl = findUrlByPageid(mandator, homeData, GRADES_PAGE_ID);
    const gradesPage = await getProtectedPageForMandator(mandator, gradesUrl, cookies, headers);

    if (gradesPage.cookies) {
        storeCookies(mandator, username, gradesPage.cookies);
    }

    return await getGradesFromHtml(gradesPage.data);
} 

async function getGradesFromHtml(html) {
    const $ = cheerio.load(html);

    const legacySubjects = (await Promise.all($('#uebersicht_bloecke>page>div>table')
        // find table with grades for each subject
        .find('tbody>tr>td>table')
        .toArray()
        .map(async x => {
            // find the previous table row with subject details
            const subjectsRowCells = $(x).parents().prev()
                .find('td')
                .toArray()
                .map(x => $(x).html());

            const clazz = subjectsRowCells[0].match('<b>([^<]*)<\\/b>')[1];
            const name = subjectsRowCells[0].match('<br>([^<]*)')[1];
            const average = subjectsRowCells[1].trim();

            // find all grades for a subject 
            const grades = (await Promise.all($(x).find('tbody>tr')
                .toArray()
                // filter header row and totalizer row
                .filter(x => !$(x).find('td>i')[0])
                .map(async x => {
                    const markRowCells = $(x)
                        .find('td')
                        .toArray()
                        .map(x => $(x).text().trim());

                    const valuePoints = markRowCells[2].split('\n');
                    const value = valuePoints[0] ? valuePoints[0] : undefined;
                    const points = valuePoints[1] ? valuePoints[1].match('Punkte: (\\d*)')[1] : undefined;
                    return {
                        date: markRowCells[0],
                        name: markRowCells[1],
                        value: value,
                        points: points,
                        weighting: markRowCells[3],
                        average: markRowCells[4]
                    };
                })))
                .filter(grade => grade.value);
            return {
                class: clazz,
                name: name,
                average: average,
                grades: grades
            };
        })))
        .filter(subjects => subjects.grades && subjects.grades.length > 0);

    if (legacySubjects.length > 0) {
        return legacySubjects;
    }

    // Newer schulNetz layout: subjects are listed in a mdl-table with hidden detail rows.
    const subjects = [];
    const mainTable = $('#uebersicht_bloecke table.mdl-table--listtable').first();
    const rows = mainTable.children('tbody').children('tr').toArray();

    rows.forEach((row, idx) => {
        const tds = $(row).children('td');
        if (tds.length < 2) {
            return;
        }

        const firstCell = $(tds[0]);
        const firstHtml = firstCell.html() || '';
        const classMatch = firstHtml.match(/<b>([^<]*)<\/b>/i);
        if (!classMatch) {
            return;
        }

        const clazz = classMatch[1].trim();
        const name = firstCell.clone().find('b').remove().end().text().replace(/\s+/g, ' ').trim();
        const average = ($(tds[1]).text() || '').replace(/\s+/g, ' ').trim();

        const grades = [];
        const detailRow = rows.slice(idx + 1).find(nextRow => /_detailrow$/.test($(nextRow).attr('class') || ''));
        if (detailRow) {
            $(detailRow).find('table.clean tr').toArray().forEach(detailTr => {
                const detailTds = $(detailTr).find('td');
                if (detailTds.length < 4) {
                    return;
                }

                const hasLegacySixColumnLayout = detailTds.length >= 6;
                const dateIdx = hasLegacySixColumnLayout ? 1 : 0;
                const nameIdx = hasLegacySixColumnLayout ? 2 : 1;
                const valueIdx = hasLegacySixColumnLayout ? 3 : 2;
                const weightingIdx = hasLegacySixColumnLayout ? 4 : 3;

                const date = $(detailTds[dateIdx]).text().trim();
                const gradeName = $(detailTds[nameIdx]).text().trim();
                const valueCell = $(detailTds[valueIdx]);
                const valueRaw = valueCell.text().replace(/\s+/g, ' ').trim();
                const valueMatch = valueRaw.match(/-?\d+(?:[.,]\d+)?/);
                const value = valueMatch ? valueMatch[0] : valueRaw;
                const weighting = ($(detailTds[weightingIdx]).text() || '').replace(/\s+/g, ' ').trim();
                const classAverage = hasLegacySixColumnLayout
                    ? ($(detailTds[5]).text() || '').replace(/\s+/g, ' ').trim()
                    : average;

                if (!date || !gradeName || !value || value === '--') {
                    return;
                }

                const pointsMatch = valueCell.html() && valueCell.html().match(/Punkte:\s*([\d.,]+)/i);
                grades.push({
                    date: date,
                    name: gradeName,
                    value: value,
                    points: pointsMatch ? pointsMatch[1] : undefined,
                    weighting: weighting,
                    average: classAverage
                });
            });
        }

        if (grades.length > 0) {
            subjects.push({
                class: clazz,
                name: name,
                average: average,
                grades: grades
            });
        }
    });

    return subjects;
}

async function getAbsences(mandator, username, password) {
    console.log('Getting absences for: ' + username);
    
    const { headers, homeData, cookies } = await getHomepageAndHeaders(mandator, username, password);
    const absencesUrl = findUrlByPageid(mandator, homeData, ABSENCES_PAGE_ID);
    const absencesPage = await getProtectedPageForMandator(mandator, absencesUrl, cookies, headers);

    if (absencesPage.cookies) {
        storeCookies(mandator, username, absencesPage.cookies);
    }

    return await getAbsencesFromHtml(absencesPage.data);
}

async function getAbsencesFromHtml(html) {
    const $ = cheerio.load(html);

    const legacyAbsences = await Promise.all($('#uebersicht_bloecke>page>div>form>table')
        // find table with grades for each subject
        .find('tbody>tr')
        .toArray()
        // filter totalizer row
        .filter(x => $(x).find('td > div > input')[0])
        .map(async x => {
            const absenceRowCells = await Promise.all($(x)
                .find('td')
                .toArray()
                .map(async x => $(x).text().trim()));

            const reason = $(x).find('td > div > input').attr('value');

            var status = absenceRowCells[3];
            if (status && status.endsWith('**')) {
                status = status.substring(0, status.length - 2).trim();
            }

            return {
                date: absenceRowCells[0],
                time: absenceRowCells[1],
                class: absenceRowCells[2],
                status: status,
                comment: absenceRowCells[4] ? absenceRowCells[4] : undefined,
                reason: reason ? reason : undefined
            };
        }));

    if (legacyAbsences.length > 0) {
        return legacyAbsences;
    }

    // GymLi/schulNetz point-based absences layout.
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const lower = value => normalize(value).toLowerCase();
    const getDate = value => {
        const match = normalize(value).match(/(\d{2}\.\d{2}\.\d{4})/);
        return match ? match[1] : null;
    };
    const getDirectRows = table => {
        const tbody = $(table).children('tbody').first();
        const container = tbody.length ? tbody : $(table);
        return container.children('tr').toArray();
    };
    const getDirectCells = row => $(row).children('th,td').toArray();
    const findHeaderIndex = (headerCells, predicate) => headerCells.findIndex(predicate);
    const extractCountFromLabelRows = (labelRegex, preferLast = false) => {
        const matches = [];

        $('table').toArray().forEach(table => {
            getDirectRows(table).forEach(row => {
                const cells = getDirectCells(row);
                if (cells.length < 2) {
                    return;
                }

                for (let i = 0; i < cells.length - 1; i++) {
                    const labelText = lower($(cells[i]).text());
                    if (!labelRegex.test(labelText)) {
                        continue;
                    }

                    const valueText = normalize(cells.slice(i + 1).map(cell => $(cell).text()).join(' '));
                    const numbers = valueText.match(/\d+/g);
                    if (numbers && numbers.length > 0) {
                        matches.push(...numbers.map(number => Number(number)));
                    }
                }
            });
        });

        if (matches.length === 0) {
            return null;
        }

        return preferLast ? matches[matches.length - 1] : matches[0];
    };

    const incidents = [];
    const openReports = [];
    const tardiness = [];

    $('table.mdl-table--listtable, table.mdl-data-table').toArray().forEach(table => {
        const rows = getDirectRows(table);
        if (rows.length === 0) {
            return;
        }

        const headerCells = getDirectCells(rows[0]).map(cell => lower($(cell).text()));

        if (headerCells.length === 0) {
            return;
        }

        const isIncidentsTable = headerCells.includes('datum von')
            && headerCells.includes('datum bis')
            && headerCells.some(value => value.includes('absenzpunkte'));
        const isOpenReportsTable = headerCells.includes('datum')
            && headerCells.includes('zeit')
            && headerCells.includes('kurs');
        const isTardinessTable = headerCells.includes('datum')
            && headerCells.includes('lektion')
            && headerCells.some(value => value.includes('zeitspanne'));

        const dateFromIdx = findHeaderIndex(headerCells, value => value.includes('datum von'));
        const dateToIdx = findHeaderIndex(headerCells, value => value.includes('datum bis'));
        const reasonIdx = findHeaderIndex(headerCells, value => value === 'grund' || value.endsWith(' grund') || value.startsWith('grund '));
        const pointsIdx = findHeaderIndex(headerCells, value => value.includes('absenzpunkte'));

        const openDateIdx = findHeaderIndex(headerCells, value => value === 'datum');
        const openTimeIdx = findHeaderIndex(headerCells, value => value === 'zeit');
        const openCourseIdx = findHeaderIndex(headerCells, value => value === 'kurs');

        const tardyDateIdx = findHeaderIndex(headerCells, value => value === 'datum');
        const tardyLessonIdx = findHeaderIndex(headerCells, value => value === 'lektion');
        const tardyReasonIdx = findHeaderIndex(headerCells, value => value === 'grund' || value.endsWith(' grund') || value.startsWith('grund '));
        const tardyTimespanIdx = findHeaderIndex(headerCells, value => value.includes('zeitspanne'));
        const tardyExcusedIdx = findHeaderIndex(headerCells, value => value.includes('entschuldigt'));

        const dataRows = rows.slice(1);

        if (isIncidentsTable) {
            dataRows.forEach(row => {
                const cells = getDirectCells(row);
                if (cells.length === 0) {
                    return;
                }

                const requiredIncidentsIndex = Math.max(dateFromIdx, dateToIdx, pointsIdx, reasonIdx, 0);
                if (cells.length <= requiredIncidentsIndex) {
                    return;
                }

                const date = getDate(cells[dateFromIdx >= 0 ? dateFromIdx : 0] ? $(cells[dateFromIdx >= 0 ? dateFromIdx : 0]).text() : '');
                const untilDate = getDate(cells[dateToIdx >= 0 ? dateToIdx : (dateFromIdx >= 0 ? dateFromIdx : 0)]
                    ? $(cells[dateToIdx >= 0 ? dateToIdx : (dateFromIdx >= 0 ? dateFromIdx : 0)]).text()
                    : '') || date;
                const reason = reasonIdx >= 0 && cells[reasonIdx]
                    ? (normalize($(cells[reasonIdx]).text()) || undefined)
                    : undefined;
                const pointsRaw = pointsIdx >= 0 && cells[pointsIdx]
                    ? normalize($(cells[pointsIdx]).text())
                    : '';
                const pointsMatch = pointsRaw.match(/-?\d+(?:[.,]\d+)?/);
                const points = pointsMatch ? pointsMatch[0] : (pointsRaw || undefined);

                if (!date) {
                    return;
                }

                incidents.push({
                    date,
                    untilDate,
                    reason,
                    points
                });
            });
            return;
        }

        if (isOpenReportsTable) {
            dataRows.forEach(row => {
                const cells = getDirectCells(row);
                if (cells.length === 0) {
                    return;
                }

                const requiredOpenReportsIndex = Math.max(openDateIdx, openTimeIdx, openCourseIdx, 0);
                if (cells.length <= requiredOpenReportsIndex) {
                    return;
                }

                const date = getDate(cells[openDateIdx >= 0 ? openDateIdx : 0]
                    ? $(cells[openDateIdx >= 0 ? openDateIdx : 0]).text()
                    : '');
                const time = openTimeIdx >= 0 && cells[openTimeIdx]
                    ? normalize($(cells[openTimeIdx]).text())
                    : normalize($(cells[1]).text());
                const course = openCourseIdx >= 0 && cells[openCourseIdx]
                    ? (normalize($(cells[openCourseIdx]).text()) || undefined)
                    : (normalize($(cells[2]).text()) || undefined);

                if (!date) {
                    return;
                }

                openReports.push({
                    date,
                    time,
                    course
                });
            });
            return;
        }

        if (isTardinessTable) {
            dataRows.forEach(row => {
                const cells = getDirectCells(row);
                if (cells.length === 0) {
                    return;
                }

                const requiredTardinessIndex = Math.max(tardyDateIdx, tardyLessonIdx, tardyReasonIdx, tardyTimespanIdx, tardyExcusedIdx, 0);
                if (cells.length <= requiredTardinessIndex) {
                    return;
                }

                const date = getDate(cells[tardyDateIdx >= 0 ? tardyDateIdx : 0]
                    ? $(cells[tardyDateIdx >= 0 ? tardyDateIdx : 0]).text()
                    : '');
                const lesson = tardyLessonIdx >= 0 && cells[tardyLessonIdx]
                    ? (normalize($(cells[tardyLessonIdx]).text()) || undefined)
                    : (normalize($(cells[1]).text()) || undefined);
                const reason = tardyReasonIdx >= 0 && cells[tardyReasonIdx]
                    ? (normalize($(cells[tardyReasonIdx]).text()) || undefined)
                    : (normalize($(cells[2]).text()) || undefined);
                const timespan = tardyTimespanIdx >= 0 && cells[tardyTimespanIdx]
                    ? (normalize($(cells[tardyTimespanIdx]).text()) || undefined)
                    : (normalize($(cells[3]).text()) || undefined);
                const excused = tardyExcusedIdx >= 0 && cells[tardyExcusedIdx]
                    ? (normalize($(cells[tardyExcusedIdx]).text()) || undefined)
                    : (normalize($(cells[4]).text()) || undefined);

                if (!date) {
                    return;
                }

                tardiness.push({
                    date,
                    lesson,
                    reason,
                    timespan,
                    excused
                });
            });
        }
    });

    const pageText = normalize($.root().text());
    const totalContingentFromRows = extractCountFromLabelRows(/(^|\s)kontingent:?($|\s)/i);
    const remainingContingentFromRows = extractCountFromLabelRows(/verbleibendes\s+kontingent:?/i, true);
    const totalContingentMatch = pageText.match(/Kontingent:\s*(\d+)/i);
    const remainingContingentMatch = pageText.match(/Verbleibendes\s+Kontingent:\s*((?:\d+\s*){1,4})/i);
    const missedExamsMatch = pageText.match(/Verpasste\s+Prüfungen:\s*(\d+)/i);
    const excusedTardinessFromRows = extractCountFromLabelRows(/entschuldigt:?/i);
    const unexcusedTardinessFromRows = extractCountFromLabelRows(/unentschuldigt:?/i);
    const excusedTardinessMatch = pageText.match(/Entschuldigt:\s*(\d+)/i);
    const unexcusedTardinessMatch = pageText.match(/Unentschuldigt:\s*(\d+)/i);

    const remainingFromText = remainingContingentMatch
        ? (remainingContingentMatch[1].match(/\d+/g) || []).map(value => Number(value)).pop()
        : null;

    const pointsSummary = {
        total: totalContingentFromRows != null
            ? totalContingentFromRows
            : (totalContingentMatch ? Number(totalContingentMatch[1]) : null),
        remaining: remainingContingentFromRows != null
            ? remainingContingentFromRows
            : (remainingFromText != null ? remainingFromText : null)
    };
    pointsSummary.used = pointsSummary.total != null && pointsSummary.remaining != null
        ? pointsSummary.total - pointsSummary.remaining
        : null;

    const absences = incidents.map(entry => ({
        date: entry.date,
        reason: entry.reason,
        status: 'Absence points',
        period: entry.untilDate && entry.untilDate !== entry.date ? `${entry.date} - ${entry.untilDate}` : entry.date,
        subject: '-',
        points: entry.points,
        untilDate: entry.untilDate
    }));

    return {
        absences,
        pointsSummary,
        incidents,
        openReports,
        tardiness,
        missedExams: missedExamsMatch ? Number(missedExamsMatch[1]) : null,
        tardinessSummary: {
            excused: excusedTardinessFromRows != null
                ? excusedTardinessFromRows
                : (excusedTardinessMatch ? Number(excusedTardinessMatch[1]) : null),
            unexcused: unexcusedTardinessFromRows != null
                ? unexcusedTardinessFromRows
                : (unexcusedTardinessMatch ? Number(unexcusedTardinessMatch[1]) : null)
        }
    };
}

async function getUnconfirmedGrades(mandator, username, password) {
    console.log('Getting unconfirmed grades for: ' + username);
    
    const { homeData } = await getHomepageAndHeaders(mandator, username, password);

    return await getUnconfirmedGradesFromHtml(homeData);
}

async function getProtectedPageForMandator(mandator, url, cookies, headers) {
    if (isSalMandator(mandator)) {
        let html = '';
        let mergedCookies = mergeCookies(cookies || {});
        const salReferer = (headers && (headers['Referer'] || headers['referer'])) || getHomepageUrlForMandator(mandator);

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const curlPage = fetchPageViaCurl(url, mergedCookies, {
                    referer: salReferer
                });
                html = String(curlPage.data || '');
                mergedCookies = mergeCookies(mergedCookies, curlPage.cookies);
            } catch (curlError) {
                if (SAL_DEBUG) {
                    console.warn('SAL debug: curl protected page fetch failed, falling back to axios', {
                        mandator,
                        message: curlError && curlError.message
                    });
                }

                const flow = await requestWithRedirectCookieCapture({
                    method: 'get',
                    url: url,
                    headers: Object.assign({}, headers, {
                        Referer: salReferer
                    }),
                    cookies: mergedCookies,
                    maxHops: 10
                });

                html = String((flow.response && flow.response.data) || '');
                mergedCookies = mergeCookies(mergedCookies, flow.cookies);
            }

            if (isSalPolicyAccessNotFoundShell(html) && attempt === 0) {
                const newSessionUri = getSalNewSessionUri(html);
                if (newSessionUri) {
                    try {
                        const recoveryUrl = toAbsoluteUrl(getBaseUrlForMandator(mandator), newSessionUri);
                        const recoveryPage = fetchPageViaCurl(recoveryUrl, mergedCookies, {
                            referer: salReferer
                        });
                        mergedCookies = mergeCookies(mergedCookies, recoveryPage.cookies);
                        continue;
                    } catch (recoveryError) {
                        if (SAL_DEBUG) {
                            console.warn('SAL debug: newsession recovery request failed', {
                                mandator,
                                message: recoveryError && recoveryError.message
                            });
                        }
                    }
                }
            }

            break;
        }

        if (SAL_DEBUG) {
            const pageIdMatch = String(url || '').match(/[?&]pageid=(\d+)/i);
            const pageLabel = pageIdMatch && pageIdMatch[1] ? `pageid-${pageIdMatch[1]}` : 'unknown-page';
            const debugFile = path.join(os.tmpdir(), `kaschuso-sal-${normalizeMandatorName(mandator)}-${pageLabel}.html`);
            fs.writeFileSync(debugFile, html, 'utf8');
            console.warn('SAL debug: protected page dump written to', debugFile);
        }

        if (isSalAclLogoutShell(html)) {
            const error = new Error('SAL protected page denied by upstream ACL (errorcode=17)');
            error.name = 'UpstreamSessionContextError';
            throw error;
        }

        if (isSalPolicyAccessNotFoundShell(html)) {
            const error = new Error('SAL protected page denied by upstream policy context (access_notfound)');
            error.name = 'UpstreamSessionContextError';
            throw error;
        }

        return {
            data: html,
            cookies: mergedCookies
        };
    }

    const res = await axios.get(url, {
        withCredentials: true,
        headers: headers,
        maxRedirects: 0
    });

    return {
        data: String(res.data || ''),
        cookies: mergeCookies(cookies, res.cookies)
    };
}

async function getUnconfirmedGradesFromHtml(html) {
    const $ = cheerio.load(html);

    const grades = [];

    // Find the table containing "Ihre letzten Noten" (Your latest grades/unconfirmed grades)
    // Look for tables with mdl-data-table class
    const tables = $('table.mdl-data-table').toArray();

    for (const tableElement of tables) {
        const $table = $(tableElement);
        const rows = $table.find('tbody > tr').toArray();

        // Check if this is the unconfirmed grades table by verifying structure
        // Should have exactly 4 columns: subject, name, date, value
        if (rows.length === 0) continue;

        const firstRow = $(rows[0]).find('td');
        if (firstRow.length !== 4) continue;

        // Parse all rows in this table as potential unconfirmed grades
        rows.forEach(row => {
            const cells = $(row).find('td.mdl-data-table__cell--non-numeric');
            if (cells.length !== 4) return;

            const subject = $(cells[0]).text().trim();
            const name = $(cells[1]).text().trim();
            const date = $(cells[2]).text().trim();
            const value = $(cells[3]).text().trim();

            if (subject && name && date && value) {
                grades.push({
                    subject: subject,
                    name: name,
                    date: date,
                    value: value
                });
            }
        });

        // If we found grades in this table, return them
        // (the first table with the right structure should be the unconfirmed grades)
        if (grades.length > 0) {
            return grades;
        }
    }

    return grades;
}

async function getMandators() {
    console.log('Fetching all mandators');

    try {
        const robotsMandators = await axios.get(ROBOTS_URL, {
            withCredentials: true,
            headers: DEFAULT_HEADERS,
            maxRedirects: 5
        }).then(res => getMandatorsFromRobotsTxt(res.data));

        if (robotsMandators.length > 0) {
            return mergeMandatorLists(robotsMandators, getEnabledKnownMandators());
        }
    } catch (error) {
        console.warn('Could not load mandators from robots.txt', error.message);
    }

    try {
        let headers = Object.assign({}, DEFAULT_HEADERS);
        headers['Cookie'] = toCookieHeaderString(await basicAuthenticate(LEGACY_BASE_URL));

        const discoveredMandators = await axios.get(LEGACY_BASE_URL, {
            withCredentials: true,
            headers: headers,
            maxRedirects: 5
        }).then(res => getMandatorsFromHtml(res.data));

        return mergeMandatorLists(discoveredMandators, getEnabledKnownMandators());
    } catch (error) {
        console.warn('Falling back to curated mandator list', error.message);
        return mergeMandatorLists(getEnabledKnownMandators());
    }
}

function getPortalMetadata() {
    return {
        features: {
            salPortal: ENABLE_SAL_PORTAL
        },
        upstreams: {
            legacy: {
                baseUrl: LEGACY_BASE_URL
            },
            sal: {
                baseUrl: SAL_BASE_URL,
                enabled: ENABLE_SAL_PORTAL,
                mandators: ENABLE_SAL_PORTAL ? ['gymli'] : []
            }
        }
    };
}

function getMandatorsFromRobotsTxt(robotsTxt) {
    if (typeof robotsTxt !== 'string') {
        return [];
    }

    const ignoredSlugs = new Set(['login', 'portal', 'staticfiles', 'sil-bid-check']);

    const slugs = Array.from(new Set(
        robotsTxt
            .split(/\r?\n/)
            .map(line => line.trim())
            .map(line => {
                const match = line.match(/^Disallow:\s*\/([a-z0-9-]+)\/?\s*$/i);
                return match ? match[1].toLowerCase() : undefined;
            })
            .filter(Boolean)
            .filter(slug => !ignoredSlugs.has(slug))
    ));

    return slugs.map(name => ({
        name,
        description: name,
        url: buildMandatorUrl(name)
    }));
}

async function getMandatorsFromHtml(html) {
    const $ = cheerio.load(html);

    return (await Promise.all($('body')
        .find('a')
        .toArray()
        .map(async x => {
            const url = $(x).attr('href');
            const text = $(x).text().trim();
            if (!url || url.startsWith('javascript:')) {
                return undefined;
            }

            const supportsLegacyHost = /^https?:\/\//.test(url) && url.includes('kaschuso.so.ch');
            const supportsSalHost = ENABLE_SAL_PORTAL && /^https?:\/\//.test(url) && url.includes('portal.sbl.ch');
            if (!supportsLegacyHost && !supportsSalHost) {
                return undefined;
            }

            const name = url.substr(url.lastIndexOf('/') + 1);
            if (!name || ['login', 'sil-bid-check', 'staticfiles'].includes(name)) {
                return undefined;
            }

            return {
                name: name,
                description: text,
                url: url
            };
        }))).filter(x => x);
}

function mergeMandatorLists() {
    const mandators = new Map();

    Array.from(arguments)
        .flat()
        .filter(Boolean)
        .forEach(mandator => {
            const normalizedMandator = normalizeMandator(mandator);
            if (!normalizedMandator) {
                return;
            }

            const existing = mandators.get(normalizedMandator.name);
            if (!existing) {
                mandators.set(normalizedMandator.name, {
                    name: normalizedMandator.name,
                    description: normalizedMandator.description,
                    url: normalizedMandator.url
                });
                return;
            }

            mandators.set(normalizedMandator.name, {
                name: existing.name,
                description: pickBestMandatorDescription(existing.description, normalizedMandator.description, normalizedMandator.name),
                url: normalizedMandator.url || buildMandatorUrl(normalizedMandator.name)
            });
        });

    return Array.from(mandators.values())
        .sort((left, right) => left.description.localeCompare(right.description));
}

function normalizeMandatorName(name) {
    if (!name || typeof name !== 'string') {
        return undefined;
    }

    const slug = name.trim().toLowerCase();
    return MANDATOR_ALIASES[slug] || slug;
}

function normalizeMandator(mandator) {
    if (!mandator || !mandator.name) {
        return undefined;
    }

    const name = normalizeMandatorName(mandator.name);
    if (!name) {
        return undefined;
    }

    const rawDescription = (mandator.description || '').trim();
    const isAliasDescription = rawDescription && normalizeMandatorName(rawDescription) === name;
    const description = rawDescription && !isAliasDescription ? rawDescription : name;

    return {
        name,
        description,
        url: mandator.url || buildMandatorUrl(name)
    };
}

function pickBestMandatorDescription(existingDescription, incomingDescription, name) {
    const current = existingDescription || name;
    const incoming = incomingDescription || name;
    const currentGeneric = current === name;
    const incomingGeneric = incoming === name;

    if (currentGeneric && !incomingGeneric) {
        return incoming;
    }

    return current;
}

function findUrlByPageid(mandator, html, pageid) {
    const match = String(html || '').match('"(index\\.php\\?pageid=' + pageid + '[^"]*)"');
    if (!match || !match[1]) {
        if (isSalMandator(mandator)) {
            // SAL responses can occasionally return a webtop/logout shell without embedded page links.
            // Fall back to direct pageid navigation using the authenticated session cookies.
            return getBaseUrlForMandator(mandator) + mandator + '/index.php?pageid=' + pageid;
        }

        const error = new TypeError('Could not find pageid=' + pageid + ' in homepage HTML');
        error.name = 'UpstreamParsingError';
        throw error;
    }

    return getBaseUrlForMandator(mandator) + mandator + '/' + match[1];
}

function getRequestMaxRedirectsForMandator(mandator) {
    return isSalMandator(mandator) ? 5 : 0;
}

function getHomepageUrlForMandator(mandator) {
    const baseUrl = getBaseUrlForMandator(mandator);
    if (isSalMandator(mandator)) {
        return baseUrl + mandator + '/';
    }

    return baseUrl + mandator + '/loginto.php';
}

function getSalHomepageCandidates(mandator) {
    const baseUrl = getBaseUrlForMandator(mandator);
    const normalizedMandator = normalizeMandatorName(mandator);
    const directCandidates = [
        baseUrl + normalizedMandator + '/',
        baseUrl + normalizedMandator + '/loginto.php'
    ];

    const rewrittenCandidates = SAL_TRY_REWRITTEN_LAUNCH
        ? [
            getSalPortalAccessBaseUrl(mandator),
            getSalPortalAccessBaseUrl(mandator) + 'loginto.php'
        ]
        : [];

    const candidates = directCandidates.concat(rewrittenCandidates);

    return Array.from(new Set(candidates));
}

function hasPageLinks(homeHtml) {
    return /index\.php\?pageid=\d+/i.test(String(homeHtml || ''));
}

function getSalSchulnetzLoginUrl(homeHtml, mandator) {
    const html = String(homeHtml || '');
    if (!html) {
        return null;
    }

    const $ = cheerio.load(html);
    const normalizedMandator = normalizeMandatorName(mandator);
    const preferredHref = $(`a[href*="/${normalizedMandator}/index.php"]`).first().attr('href');
    if (preferredHref) {
        return toAbsoluteUrl(getBaseUrlForMandator(mandator), preferredHref);
    }

    const genericHref = $('a[href*="index.php"]').first().attr('href');
    return genericHref ? toAbsoluteUrl(getBaseUrlForMandator(mandator), genericHref) : null;
}

function isSalAclLogoutShell(html) {
    const normalized = String(html || '');
    return /"pageType"\s*:\s*"logout"/i.test(normalized)
        && /"errorcode"\s*:\s*17/i.test(normalized)
        && /my\.acl/i.test(normalized);
}

function isSalLogout(html) {
    const normalized = String(html || '');
    return /"pageType"\s*:\s*"logout"/i.test(normalized);
}

function isSalPolicyAccessNotFoundShell(html) {
    const normalized = String(html || '');
    return /"pageType"\s*:\s*"logout"/i.test(normalized)
        && /"subtype"\s*:\s*"access_notfound"/i.test(normalized);
}

function getSalNewSessionUri(html) {
    const match = String(html || '').match(/"type"\s*:\s*"newsession"[\s\S]*?"uri"\s*:\s*"([^\"]+)"/i);
    return match && match[1] ? match[1] : null;
}

function getCookieHeaders(cookies, additionalHeaders) {
    const headers = Object.assign({}, DEFAULT_HEADERS, additionalHeaders || {});
    const cookieHeader = toCookieHeaderString(cookies || {});
    if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
    }

    return headers;
}

function getSalResourceQueryParam(resourceListXml, listType) {
    const xml = cheerio.load(String(resourceListXml || ''), { xmlMode: true });
    return xml(`list[type="${listType}"] > entry[type="group_names"]`).attr('param') || null;
}

function getSalResourceIds(resourceListXml, listType) {
    const xml = cheerio.load(String(resourceListXml || ''), { xmlMode: true });
    const idsRaw = xml(`list[type="${listType}"] > entry[type="group_names"]`).first().text() || '';
    return idsRaw.split(/\s+/).map(value => value.trim()).filter(Boolean);
}

function findSalResourceIdForMandator(resourceIds, mandator) {
    const normalizedMandator = normalizeMandatorName(mandator);
    if (!normalizedMandator || !Array.isArray(resourceIds)) {
        return null;
    }

    const preferred = resourceIds.find(resourceId => {
        const normalizedId = String(resourceId || '').toLowerCase();
        return normalizedId.endsWith('/' + normalizedMandator) || normalizedId.includes('/' + normalizedMandator);
    });

    return preferred || null;
}

function getSalResourceApplicationUri(resourceInfoXml, resourceId) {
    const xml = cheerio.load(String(resourceInfoXml || ''), { xmlMode: true });
    const items = xml('item');

    let appUri = null;
    items.each((_, item) => {
        if (appUri) {
            return;
        }

        const node = xml(item);
        const currentId = (node.find('id').first().text() || '').trim();
        if (!currentId || currentId.toLowerCase() !== String(resourceId || '').toLowerCase()) {
            return;
        }

        appUri = (node.find('application_uri').first().text() || '').trim() || null;
    });

    return appUri;
}

function toAbsoluteUrl(baseUrl, maybeRelativeUrl) {
    if (!maybeRelativeUrl) {
        return null;
    }

    return new URL(maybeRelativeUrl, baseUrl).toString();
}

function getSalPortalAccessBaseUrl(mandator) {
    const baseUrl = getBaseUrlForMandator(mandator);
    const normalizedMandator = normalizeMandatorName(mandator);
    const origin = new URL(baseUrl).origin;
    const encodedOrigin = Buffer.from(origin, 'utf8').toString('hex');

    return `${baseUrl}f5-w-${encodedOrigin}$$/${normalizedMandator}/`;
}

function toSalPortalAccessUrl(mandator, candidateUrl) {
    const baseUrl = getBaseUrlForMandator(mandator);
    const normalizedMandator = normalizeMandatorName(mandator);
    const rewrittenBase = getSalPortalAccessBaseUrl(mandator);

    if (!candidateUrl) {
        return rewrittenBase;
    }

    const absolute = new URL(candidateUrl, baseUrl);
    const expectedPrefix = '/' + normalizedMandator + '/';

    if (absolute.origin !== new URL(baseUrl).origin || !absolute.pathname.startsWith(expectedPrefix)) {
        return absolute.toString();
    }

    const suffixPath = absolute.pathname.slice(expectedPrefix.length);
    const query = absolute.search || '';
    const hash = absolute.hash || '';
    return `${rewrittenBase}${suffixPath}${query}${hash}`;
}

async function launchSalWebtopResource(mandator, cookies) {
    if (!isSalMandator(mandator)) {
        return cookies;
    }

    const baseUrl = getBaseUrlForMandator(mandator);
    let mergedCookies = mergeCookies(cookies || {});
    
    if (SAL_DEBUG && mergedCookies[SAL_COOKIE_JAR_RAW_KEY]) {
        console.warn('SAL debug: Launch cookie jar reused:', mergedCookies[SAL_COOKIE_JAR_RAW_KEY]);
    }

    // Keep SAL session transitions on curl+jars to match known-good manual flow semantics.
    /* SKIPPED: Authenticate logic already lands on webtop. Re-requesting it triggers logout.
    const webtopPage = fetchPageViaCurl(baseUrl + SAL_WEBTOP_URL.replace(/^\//, ''), mergedCookies, {
        referer: baseUrl + 'my.policy'
    });
    mergedCookies = mergeCookies(mergedCookies, webtopPage.cookies);

    if (SAL_DEBUG) {
        const debugFile = path.join(os.tmpdir(), `kaschuso-sal-webtop-${normalizeMandatorName(mandator)}.html`);
        fs.writeFileSync(debugFile, String(webtopPage.data || ''), 'utf8');
        console.warn('SAL debug: webtop dump written to', debugFile);
    }
    */

    const resourceListPage = fetchPageViaCurl(baseUrl + SAL_RESOURCE_LIST_URL.replace(/^\//, ''), mergedCookies, {
        referer: baseUrl + SAL_WEBTOP_URL.replace(/^\//, ''),
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8'
        }
    });

    mergedCookies = mergeCookies(mergedCookies, resourceListPage.cookies);

    if (SAL_DEBUG) {
        const debugFile = path.join(os.tmpdir(), `kaschuso-sal-resource-list-${normalizeMandatorName(mandator)}.xml`);
        fs.writeFileSync(debugFile, String(resourceListPage.data || ''), 'utf8');
        console.warn('SAL debug: resource list dump written to', debugFile);
    }

    const directLaunchUrl = baseUrl + mandator + '/';
    let launchUrl = SAL_TRY_REWRITTEN_LAUNCH ? getSalPortalAccessBaseUrl(mandator) : directLaunchUrl;

    const queryParam = getSalResourceQueryParam(resourceListPage.data, 'webtop_link');
    const resourceIds = getSalResourceIds(resourceListPage.data, 'webtop_link');
    const resourceId = findSalResourceIdForMandator(resourceIds, mandator);

    // In this environment resource_info_v2 can hard-reset and invalidate the flow.
    // Keep it opt-in only; default to direct launch URL confirmed from browser behavior.
    if (SAL_USE_RESOURCE_INFO && queryParam && resourceId) {
        try {
            const infoQuery = `${encodeURIComponent(queryParam)}=${encodeURIComponent(resourceId)}`;
            const resourceInfoFlow = await requestWithRedirectCookieCapture({
                method: 'get',
                url: `${baseUrl}${SAL_RESOURCE_INFO_URL.replace(/^\//, '')}?${infoQuery}`,
                headers: getCookieHeaders(mergedCookies, {
                    'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': baseUrl + SAL_WEBTOP_URL.replace(/^\//, '')
                }),
                cookies: mergedCookies,
                maxHops: 5
            });

            mergedCookies = mergeCookies(mergedCookies, resourceInfoFlow.cookies);
            const applicationUri = getSalResourceApplicationUri(resourceInfoFlow.response && resourceInfoFlow.response.data, resourceId);
            launchUrl = toSalPortalAccessUrl(mandator, toAbsoluteUrl(baseUrl, applicationUri)) || launchUrl;
        } catch (error) {
            // In some environments this endpoint resets the connection. Keep progressing with base launch URL.
            console.warn('SAL resource_info request failed, using direct launch fallback', {
                mandator,
                message: error && error.message,
                code: error && error.code
            });
        }
    } else if (SAL_DEBUG) {
        console.warn('SAL debug: skipping resource_info_v2 lookup and using direct launch URL', {
            mandator,
            launchUrl,
            hasResourceId: Boolean(resourceId)
        });
    }

    const launchCandidates = SAL_TRY_REWRITTEN_LAUNCH
        ? Array.from(new Set([launchUrl, directLaunchUrl]))
        : [directLaunchUrl];
    let launchSucceeded = false;

    for (const candidateUrl of launchCandidates) {
        try {
            const launchPage = fetchPageViaCurl(candidateUrl, mergedCookies, {
                referer: baseUrl + SAL_WEBTOP_URL.replace(/^\//, '')
            });
            mergedCookies = mergeCookies(mergedCookies, launchPage.cookies);
            launchSucceeded = true;
            break;
        } catch (curlError) {
            if (SAL_DEBUG) {
                console.warn('SAL debug: curl launch request failed', {
                    mandator,
                    candidateUrl,
                    message: curlError && curlError.message
                });
            }

            try {
                const launchFlow = await requestWithRedirectCookieCapture({
                    method: 'get',
                    url: candidateUrl,
                    headers: getCookieHeaders(mergedCookies, {
                        'Referer': baseUrl + SAL_WEBTOP_URL.replace(/^\//, '')
                    }),
                    cookies: mergedCookies,
                    maxHops: 10
                });

                mergedCookies = mergeCookies(mergedCookies, launchFlow.cookies);
                launchSucceeded = true;
                break;
            } catch (axiosError) {
                if (SAL_DEBUG) {
                    console.warn('SAL debug: axios launch request failed', {
                        mandator,
                        candidateUrl,
                        message: axiosError && axiosError.message
                    });
                }
            }
        }
    }

    if (!launchSucceeded) {
        const error = new Error('SAL launch request failed for all launch URL candidates');
        error.name = 'UpstreamSessionContextError';
        throw error;
    }

    return mergedCookies;
}

async function getSalHomepageWithRecovery(mandator, cookies) {
    let mergedCookies = mergeCookies(cookies || {});
    const homepageCandidates = getSalHomepageCandidates(mandator);
    const baseUrl = getBaseUrlForMandator(mandator);
    let latestHomeData = '';

    for (let attempt = 0; attempt < 2; attempt++) {
        for (const homepageUrl of homepageCandidates) {
            try {
                const homePage = fetchPageViaCurl(homepageUrl, mergedCookies, {
                    referer: baseUrl + SAL_WEBTOP_URL.replace(/^\//, '')
                });

                mergedCookies = mergeCookies(mergedCookies, homePage.cookies);
                latestHomeData = String(homePage.data || '');

                if (hasPageLinks(latestHomeData)) {
                    return {
                        cookies: mergedCookies,
                        homeData: latestHomeData
                    };
                }

                const loginBridgeUrl = getSalSchulnetzLoginUrl(latestHomeData, mandator);
                if (loginBridgeUrl) {
                    const loginBridgePage = fetchPageViaCurl(loginBridgeUrl, mergedCookies, {
                        referer: homepageUrl
                    });

                    mergedCookies = mergeCookies(mergedCookies, loginBridgePage.cookies);
                    latestHomeData = String(loginBridgePage.data || latestHomeData);

                    if (hasPageLinks(latestHomeData)) {
                        return {
                            cookies: mergedCookies,
                            homeData: latestHomeData
                        };
                    }

                    if (SAL_DEBUG) {
                        console.warn('SAL debug: schulNetz login bridge did not yield page links', {
                            mandator,
                            attempt,
                            homepageUrl,
                            loginBridgeUrl
                        });
                    }
                }

                if (SAL_DEBUG) {
                    console.warn('SAL debug: homepage candidate missing page links', {
                        mandator,
                        attempt,
                        homepageUrl,
                        finalUrl: homepageUrl,
                        status: null
                    });
                }
            } catch (error) {
                if (SAL_DEBUG) {
                    console.warn('SAL debug: homepage candidate request failed', {
                        mandator,
                        attempt,
                        homepageUrl,
                        message: error && error.message,
                        code: error && error.code
                    });
                }
            }
        }

        if (attempt === 0) {
            mergedCookies = await launchSalWebtopResource(mandator, mergedCookies);
        }
    }

    return {
        cookies: mergedCookies,
        homeData: latestHomeData
    };
}

async function getHomepageAndHeaders(mandator, username, password) {
    let cookies = await getCookies(mandator, username, password);
    let homeData;

    if (isSalMandator(mandator)) {
        try {
            const salHome = await getSalHomepageWithRecovery(mandator, cookies);
            cookies = salHome.cookies;
            homeData = salHome.homeData;

            if (isSalAclLogoutShell(homeData) || isSalLogout(homeData)) {
                throw new Error('SAL session invalid (logout shell)');
            }
            if (!hasPageLinks(homeData)) {
                throw new Error('SAL session missing page links');
            }
        } catch (error) {
            if (SAL_DEBUG) {
                console.warn('SAL debug: session check/fetch failed, forcing re-auth', {
                    mandator,
                    message: error.message
                });
            }
            // Force fresh authentication and retry once
            cookies = await authenticate(mandator, username, password);
            const salHomeRetry = await getSalHomepageWithRecovery(mandator, cookies);
            cookies = salHomeRetry.cookies;
            homeData = salHomeRetry.homeData;
        }
        storeCookies(mandator, username, cookies);
    } else {
        const headers = getCookieHeaders(cookies);
        const homepageUrl = getHomepageUrlForMandator(mandator);
        const res = await axios.get(homepageUrl, {
            withCredentials: true,
            headers: headers,
            maxRedirects: getRequestMaxRedirectsForMandator(mandator)
        });
        cookies = mergeCookies(cookies, res.cookies);
        homeData = res.data;
    }

    if (SAL_DEBUG && isSalMandator(mandator) && !hasPageLinks(homeData)) {
        const debugFile = path.join(os.tmpdir(), `kaschuso-sal-home-${mandator}.html`);
        fs.writeFileSync(debugFile, String(homeData || ''), 'utf8');
        console.warn('SAL debug: homepage without page links dumped to', debugFile);
    }

    if (isSalMandator(mandator) && (isSalAclLogoutShell(homeData) || isSalLogout(homeData))) {
        const error = new Error('SAL session context denied by upstream (re-auth failed)');
        error.name = 'UpstreamSessionContextError';
        throw error;
    }

    return {
        headers: Object.assign({}, getCookieHeaders(cookies), isSalMandator(mandator)
            ? { Referer: getHomepageUrlForMandator(mandator) }
            : {}),
        homeData: homeData,
        cookies: cookies
    };
}

async function getCookies(mandator, username, password) {
    const key = mandator + ":" + username;
    let cookies = cookiesMap[key];
    if (!cookies) {
        cookies = await authenticate(mandator, username, password);
        cookiesMap[key] = cookies;
    } else {
        // check if cookies are valid
        const homepageUrl = getHomepageUrlForMandator(mandator);

        let sessionLooksValid = false;

        if (isSalMandator(mandator)) {
            // Probe can be destructive to F5 session state.
            // We assume validity here and handle re-auth in getHomepageAndHeaders if needed.
            sessionLooksValid = true;
        } else {
            let headers = Object.assign({}, DEFAULT_HEADERS);
            headers['Cookie'] = toCookieHeaderString(cookies);

            const homeRes = await axios.get(homepageUrl, {
                withCredentials: true,
                headers: headers,
                maxRedirects: getRequestMaxRedirectsForMandator(mandator)
            });
            sessionLooksValid = homeRes.status === 200 && hasPageLinks(homeRes.data);
        }

        if (!sessionLooksValid) {
            console.log('Session expired for: ' + username);
            cookies = await authenticate(mandator, username, password);
            cookiesMap[key] = cookies;
        } else {
            cookiesMap[key] = cookies;
        }
    }

    return cookies;
}

function storeCookies(mandator, username, cookies) {
    cookiesMap[mandator + ":" + username] = cookies;
}

function toCookieHeaderString(cookies) {
    let headerString = "";

    for (var k in cookies) {
        if (k === SAL_COOKIE_JAR_RAW_KEY) {
            continue;
        }
        if (headerString) {
            headerString += "; ";
        }
        headerString += k + "=" + cookies[k]
    }

    return headerString;
}

function getResponseStatus(response) {
    return response && (response.status || (response.error && response.error.response && response.error.response.status));
}

function resolveRedirectUrl(currentUrl, locationValue) {
    if (!locationValue) {
        return currentUrl;
    }

    return new URL(locationValue, currentUrl).toString();
}

async function requestWithRedirectCookieCapture(options) {
    const method = options.method || 'get';
    const data = options.data;
    const maxHops = options.maxHops || 5;
    let url = options.url;
    let cookies = options.cookies || {};
    let lastResponse;

    for (let hop = 0; hop < maxHops; hop++) {
        const headers = Object.assign({}, DEFAULT_HEADERS, options.headers || {});
        const cookieHeader = toCookieHeaderString(cookies);
        if (cookieHeader) {
            headers['Cookie'] = cookieHeader;
        }

        lastResponse = await axios({
            method: method,
            url: url,
            data: data,
            withCredentials: true,
            headers: headers,
            maxRedirects: 0
        });

        cookies = mergeCookies(cookies, lastResponse.cookies);

        const status = getResponseStatus(lastResponse);
        const locationValue = lastResponse.locationValue;
        const isRedirect = status >= 300 && status < 400 && Boolean(locationValue);

        if (!isRedirect) {
            return {
                response: lastResponse,
                cookies: cookies,
                finalUrl: url
            };
        }

        url = resolveRedirectUrl(url, locationValue);
    }

    return {
        response: lastResponse,
        cookies: cookies,
        finalUrl: url
    };
}

function hasAuthenticatedSessionCookie(cookies) {
    if (!cookies) {
        return false;
    }

    return Object.keys(cookies).some(function(cookieName) {
        return /^SCDID(?:_|$)/.test(cookieName);
    });
}

function buildAuthenticationDiagnostics(loginRes) {
    const responseBody = loginRes && typeof loginRes.data === 'string' ? loginRes.data : '';
    const page = responseBody ? cheerio.load(responseBody) : null;

    const errorText = page ? page('.sls-global-errors-msg, [class*="error"], .alert').text().trim() : '';

    return {
        status: loginRes && (loginRes.status || (loginRes.error && loginRes.error.response && loginRes.error.response.status)) || null,
        hasLocationHeader: Boolean(loginRes && loginRes.locationValue),
        locationValue: loginRes && loginRes.locationValue ? loginRes.locationValue : null,
        cookieNames: Object.keys((loginRes && loginRes.cookies) || {}),
        responseTitle: page ? page('title').text().trim() || null : null,
        hasLoginForm: Boolean(page && page('form').length),
        hasPasswordField: Boolean(page && page('input[type=password], input[name=password]').length),
        hasCredentialError: Boolean(errorText),
        credentialErrorText: errorText || null,
        bodyPreview: responseBody
            ? responseBody.replace(/\s+/g, ' ').trim().slice(0, 160)
            : null
    };
}

function getCookiesFromHeaders(headers) {
    const cookies = {};
    if (headers['set-cookie']) {
        headers['set-cookie'].forEach(cookie => {
            const firstSegment = cookie.split(';')[0];
            const separatorIndex = firstSegment.indexOf('=');
            if (separatorIndex === -1) {
                return;
            }

            const key = firstSegment.slice(0, separatorIndex);
            const value = firstSegment.slice(separatorIndex + 1);
            cookies[key] = value;
        });
    }
    return cookies;
}

axios.interceptors.response.use((response) => {
    response.cookies = getCookiesFromHeaders(response.headers);
    return response;
}, (error) => {
    if (error && error.response && error.response.status >= 300 && error.response.status < 400) {
        const cookies = getCookiesFromHeaders(error.response.headers);
        const locationValue = error.response.headers.location;
        return Promise.resolve({error, cookies, locationValue});
    }
    return Promise.reject(error);
});

module.exports = {
    authenticate,
    getAuthenticationFailureInfo,
    hasAuthenticatedSessionCookie,
    mergeCookies,
    getUserInfo,
    getGrades,
    getAbsences,
    getMandators,
    getPortalMetadata,
    getUnconfirmedGrades,
    // for testing 
    getCookiesFromHeaders,
    toCookieHeaderString,
    findUrlByPageid,
    mergeMandatorLists,
    getMandatorsFromRobotsTxt,
    normalizeMandatorName,
    getMandatorsFromHtml,
    getAbsencesFromHtml,
    getGradesFromHtml,
    getUnconfirmedGradesFromHtml,
    getUserInfoFromHtml,
    getCurrentRequestedPageFromHtml,
    getLoginPayloadFromHtml,
    getActionFromSesJs
};