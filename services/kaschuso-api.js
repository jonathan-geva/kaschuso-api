const cryptoRandomString = require('crypto-random-string');

const axios = require('axios').default;
axios.defaults.withCredentials = true;

const qs = require('qs');
const cheerio = require('cheerio');

const BASE_URL   = process.env.KASCHUSO_BASE_URL || 'https://kaschuso.so.ch/';
const FORM_URL   = BASE_URL + 'login/sls/auth?RequestedPage=%2f';
const LOGIN_URL  = BASE_URL + 'login/sls/';
const SES_JS_URL = BASE_URL + 'sil-bid-check/ses.js';
const ROBOTS_URL = BASE_URL + 'robots.txt';
const BASE_ORIGIN = new URL(BASE_URL).origin;

const MANDATOR_ALIASES = {
    kbssogr: 'kbsso'
};

const KNOWN_MANDATORS = [
    {
        name: 'bzwh',
        description: 'Bildungszentrum Wallierhof',
        url: BASE_URL + 'bzwh'
    },
    {
        name: 'ebzol',
        description: 'Erwachsenenbildungszentrum Olten',
        url: BASE_URL + 'ebzol'
    },
    {
        name: 'ebzso',
        description: 'Erwachsenenbildungszentrum Solothurn',
        url: BASE_URL + 'ebzso'
    },
    {
        name: 'gibsgr',
        description: 'Gewerblich-industrielle Berufsfachschule Grenchen',
        url: BASE_URL + 'gibsgr'
    },
    {
        name: 'gibsol',
        description: 'Gewerblich-industrielle Berufsfachschule Olten',
        url: BASE_URL + 'gibsol'
    },
    {
        name: 'gibsso',
        description: 'Gewerblich-industrielle Berufsfachschule Solothurn',
        url: BASE_URL + 'gibsso'
    },
    {
        name: 'hfpo',
        description: 'Hoehere Fachschule Pflege Olten',
        url: BASE_URL + 'hfpo'
    },
    {
        name: 'kbsol',
        description: 'Kaufmaennische Berufsfachschule Olten',
        url: BASE_URL + 'kbsol'
    },
    {
        name: 'kbsso',
        description: 'Kaufmaennische Berufsfachschule Solothurn',
        url: BASE_URL + 'kbsso'
    },
    {
        name: 'ksol',
        description: 'Kantonsschule Olten',
        url: BASE_URL + 'ksol'
    },
    {
        name: 'ksso',
        description: 'Kantonsschule Solothurn',
        url: BASE_URL + 'ksso'
    }
];


const GRADES_PAGE_ID   = 21311;
const ABSENCES_PAGE_ID = 21111;
const SETTINGS_PAGE_ID = 22500;

const SES_PARAM_REGEX = /var bid = getBid\('([^']*?)'/;

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
    return axios.get(BASE_URL, {
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

    // set basic cookies to request login page
    var cookies = await basicAuthenticate();

    let headers = Object.assign({}, DEFAULT_HEADERS);
    headers['Cookie'] = toCookieHeaderString(cookies);

    // request login page
    const [formRes, sesJS] = await Promise.all([
        axios.get(FORM_URL + mandator, {
            withCredentials: true,
            headers: headers,
            maxRedirects: 0
        }),
        axios.get(SES_JS_URL, {
            withCredentials: true,
            headers: headers,
            maxRedirects: 0
        })
    ]);

    cookies = mergeCookies(cookies, formRes.cookies, sesJS.cookies);
    headers['Cookie'] = toCookieHeaderString(cookies);

    let loginHeaders = Object.assign({}, headers);
    loginHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    loginHeaders['Origin'] = BASE_ORIGIN;
    loginHeaders['Referer'] = FORM_URL + mandator;

    // make login
    const loginPayload = getLoginPayloadFromHtml(formRes.data, username, password);

    const loginRes = await axios.post(LOGIN_URL + getActionFromSesJs(sesJS.data), 
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
    const param = html.match(SES_PARAM_REGEX)[1];
    return 'auth?' + param + '=' + cryptoRandomString({ length: 32, type: 'hex' });
}

async function getUserInfo(mandator, username, password) {
    console.log('Getting user info for: ' + username);

    const { headers, homeData } = await getHomepageAndHeaders(mandator, username, password);

    const settingsRes = await axios.get(findUrlByPageid(mandator, homeData, SETTINGS_PAGE_ID), {
        withCredentials: true,
        headers: headers,
        maxRedirects: 0
    });

    return await getUserInfoFromHtml(homeData, settingsRes.data, mandator, username);
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
                .map(x => $home(x).text());
            infos[row[0]] = row[1];
        }));

    const $settings = cheerio.load(settingsHtml);

    const email = $settings('#f0').attr('value');
    const privateEmail = $settings('#f1').attr('value');

    return {
        mandator: mandator,
        username: username,
        name: infos['Name'],
        address: infos['Adresse'],
        zipCity: infos['Ort'],
        birthdate: infos['Geburtsdatum'],
        education: infos['Ausbildungsgang'],
        hometown: infos['Heimatort'],
        phone: infos['Telefon'],
        mobile: infos['Mobiltelefon'],
        email: email,
        privateEmail: privateEmail,
    };
}

async function getGrades(mandator, username, password) {
    console.log('Getting grades for: ' + username);
    
    const { headers, homeData } = await getHomepageAndHeaders(mandator, username, password);

    const gradesRes = await axios.get(findUrlByPageid(mandator, homeData, GRADES_PAGE_ID), {
        withCredentials: true,
        headers: headers,
        maxRedirects: 0
    });

    return await getGradesFromHtml(gradesRes.data);
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
                if (detailTds.length < 6 || $(detailTr).find('td.td_einzelpruefungen').length < 3) {
                    return;
                }

                const date = $(detailTds[1]).text().trim();
                const gradeName = $(detailTds[2]).text().trim();
                const valueCell = $(detailTds[3]);
                const valueRaw = valueCell.text().replace(/\s+/g, ' ').trim();
                const valueMatch = valueRaw.match(/-?\d+(?:[.,]\d+)?/);
                const value = valueMatch ? valueMatch[0] : valueRaw;
                const weighting = $(detailTds[4]).text().replace(/\s+/g, ' ').trim();
                const classAverage = $(detailTds[5]).text().replace(/\s+/g, ' ').trim();

                if (!value || value === '--') {
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
    
    const { headers, homeData } = await getHomepageAndHeaders(mandator, username, password);

    const absencesRes = await axios.get(findUrlByPageid(mandator, homeData, ABSENCES_PAGE_ID), {
        withCredentials: true,
        headers: headers,
        maxRedirects: 0
    });

    return await getAbsencesFromHtml(absencesRes.data);
}

async function getAbsencesFromHtml(html) {
    const $ = cheerio.load(html);

    return await Promise.all($('#uebersicht_bloecke>page>div>form>table')
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
            return mergeMandatorLists(robotsMandators, KNOWN_MANDATORS);
        }
    } catch (error) {
        console.warn('Could not load mandators from robots.txt', error.message);
    }

    try {
        let headers = Object.assign({}, DEFAULT_HEADERS);
        headers['Cookie'] = toCookieHeaderString(await basicAuthenticate());

        const discoveredMandators = await axios.get(BASE_URL, {
            withCredentials: true,
            headers: headers,
            maxRedirects: 5
        }).then(res => getMandatorsFromHtml(res.data));

        return mergeMandatorLists(discoveredMandators, KNOWN_MANDATORS);
    } catch (error) {
        console.warn('Falling back to curated mandator list', error.message);
        return mergeMandatorLists(KNOWN_MANDATORS);
    }
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
        url: BASE_URL + name
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

            if (!/^https?:\/\//.test(url) || !url.includes('kaschuso.so.ch')) {
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
                url: BASE_URL + normalizedMandator.name
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
        url: BASE_URL + name
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
    return BASE_URL + mandator + '/' + html.match('"(index\\.php\\?pageid=' + pageid + '[^"]*)"')[1];
}

async function getHomepageAndHeaders(mandator, username, password) {
    let cookies = await getCookies(mandator, username, password);
    
    let headers = Object.assign({}, DEFAULT_HEADERS);
    headers['Cookie'] = toCookieHeaderString(cookies);
    
    return axios.get(BASE_URL + mandator + '/loginto.php', {
            withCredentials: true,
            headers: headers,
            maxRedirects: 0
        }).then(res => {
            cookies = { ...cookies, ...res.cookies };
            headers['Cookie'] = toCookieHeaderString(cookies);
            return {
                headers: headers,
                homeData: res.data
            };
        });
}

async function getCookies(mandator, username, password) {
    const key = mandator + ":" + username;
    let cookies = cookiesMap[key];
    if (!cookies) {
        cookies = await authenticate(mandator, username, password);
        cookiesMap[key] = cookies;
    } else {
        // check if cookies are valid
        let headers = Object.assign({}, DEFAULT_HEADERS);
        headers['Cookie'] = toCookieHeaderString(cookies);
        
        const homeRes = await axios.get(BASE_URL + mandator + '/loginto.php', {
            withCredentials: true,
            headers: headers,
            maxRedirects: 0
        });
        if (homeRes.status !== 200) {
            console.log('Session expired for: ' + username);
            cookies = await authenticate(mandator, username, password);
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
        if (headerString) {
            headerString += "; ";
        }
        headerString += k + "=" + cookies[k]
    }

    return headerString;
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
    if (error && error.response && error.response.status === 302) {
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
    getUserInfoFromHtml,
    getCurrentRequestedPageFromHtml,
    getLoginPayloadFromHtml,
    getActionFromSesJs
};