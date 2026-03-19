const fs = require('fs');

const { 
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
    getActionFromSesJs,
    getAuthenticationFailureInfo,
    hasAuthenticatedSessionCookie,
    mergeCookies
} = require('./kaschuso-api');

test('extract cookies from header', () => {
    expect(getCookiesFromHeaders({
        'set-cookie' : [
            'SCDID_S=yacJ16u6KXqt9Q-JCFgJBfCvEVooQ9jGnHqvZhOqhlHPXPqwIUza9A$$#dMp5ltMsuiHcN8lzd5oJhjUNIYLu_aDomqWWvoKShT0$; path=/; Secure; HttpOnly',
            'SLSLanguage=de; Max-Age=94608000; Path=/; Secure; HttpOnly',
            'PHPSESSID=6abvi005sklkauitprbspsoceu; path=/'
        ]
    })).toEqual({
        'SCDID_S': 'yacJ16u6KXqt9Q-JCFgJBfCvEVooQ9jGnHqvZhOqhlHPXPqwIUza9A$$#dMp5ltMsuiHcN8lzd5oJhjUNIYLu_aDomqWWvoKShT0$',
        'SLSLanguage': 'de',
        'PHPSESSID': '6abvi005sklkauitprbspsoceu'
    });
});

test('extract cookies with equals signs in value', () => {
    expect(getCookiesFromHeaders({
        'set-cookie': [
            'SCDID_S=abc=def==; path=/; Secure; HttpOnly'
        ]
    })).toEqual({
        'SCDID_S': 'abc=def=='
    });
});

test('put cookies in header string', () => {
    expect(toCookieHeaderString({
        'SCDID_S': 'yacJ16u6KXqt9Q-JCFgJBfCvEVooQ9jGnHqvZhOqhlHPXPqwIUza9A$$#dMp5ltMsuiHcN8lzd5oJhjUNIYLu_aDomqWWvoKShT0$',
        'SLSLanguage': 'de',
        'PHPSESSID': '6abvi005sklkauitprbspsoceu'
    })).toBe('SCDID_S=yacJ16u6KXqt9Q-JCFgJBfCvEVooQ9jGnHqvZhOqhlHPXPqwIUza9A$$#dMp5ltMsuiHcN8lzd5oJhjUNIYLu_aDomqWWvoKShT0$; SLSLanguage=de; PHPSESSID=6abvi005sklkauitprbspsoceu');
});

test('detect authenticated session cookies by prefix', () => {
    expect(hasAuthenticatedSessionCookie({
        'SCDID_S': 'token',
        'PHPSESSID': 'session'
    })).toBe(true);

    expect(hasAuthenticatedSessionCookie({
        'SCDID': 'token'
    })).toBe(true);

    expect(hasAuthenticatedSessionCookie({
        'PHPSESSID': 'session'
    })).toBe(false);
});

test('merge cookies keeps later upstream values', () => {
    expect(mergeCookies(
        { SLSLanguage: 'de' },
        { PHPSESSID: 'bootstrap' },
        { PHPSESSID: 'login-page', BID: 'xyz' }
    )).toEqual({
        SLSLanguage: 'de',
        PHPSESSID: 'login-page',
        BID: 'xyz'
    });
});

test('find url by pageid', async () => {
    const html = fs.readFileSync('./__test__/start.html', 'utf8');
    expect(findUrlByPageid('school', html, 22500))
    .toBe('https://kaschuso.so.ch/school/index.php?pageid=22500&id=f0c039a84fc469e6&amp;transid=5a5e77');
});

test('get mandators from html', async () => {
    const html = fs.readFileSync('./__test__/root.html', 'utf8');
    expect(await getMandatorsFromHtml(html))
    .toEqual([
        {
            "name": "bzwh",
            "description": "Bildungszentrum Wallierhof",
            "url": "https://kaschuso.so.ch/bzwh"
        },
        {
            "name": "ebzso",
            "description": "Erwachsenenbildungszentrum Solothurn",
            "url": "https://kaschuso.so.ch/ebzso"
        },
        {
            "name": "gibsso",
            "description": "Gewerblich-industrielle Berufsfachschule Solothurn",
            "url": "https://kaschuso.so.ch/gibsso"
        }
    ]);
});

test('get mandators from robots.txt', () => {
    const robotsTxt = [
        'Disallow: /bzwh/',
        'Disallow: /gibsso/',
        'Disallow: /kbsso/',
        'Disallow: /portal/'
    ].join('\n');

    expect(getMandatorsFromRobotsTxt(robotsTxt)).toEqual([
        {
            name: 'bzwh',
            description: 'bzwh',
            url: 'https://kaschuso.so.ch/bzwh'
        },
        {
            name: 'gibsso',
            description: 'gibsso',
            url: 'https://kaschuso.so.ch/gibsso'
        },
        {
            name: 'kbsso',
            description: 'kbsso',
            url: 'https://kaschuso.so.ch/kbsso'
        }
    ]);
});

test('normalize mandator aliases to canonical slug', () => {
    expect(normalizeMandatorName('kbssogr')).toBe('kbsso');
    expect(normalizeMandatorName('KBSsOGR')).toBe('kbsso');
    expect(normalizeMandatorName('ksso')).toBe('ksso');
});

test('merge mandators appends curated fallbacks without duplicating live entries', () => {
    expect(mergeMandatorLists(
        [
            {
                name: 'gibsso',
                description: 'Live GIBS Solothurn',
                url: 'https://kaschuso.so.ch/gibsso'
            }
        ],
        [
            {
                name: 'gibsso',
                description: 'Fallback GIBS Solothurn',
                url: 'https://kaschuso.so.ch/gibsso'
            },
            {
                name: 'ksso',
                description: 'Kantonsschule Solothurn',
                url: 'https://kaschuso.so.ch/ksso'
            }
        ]
    )).toEqual([
        {
            name: 'ksso',
            description: 'Kantonsschule Solothurn',
            url: 'https://kaschuso.so.ch/ksso'
        },
        {
            name: 'gibsso',
            description: 'Live GIBS Solothurn',
            url: 'https://kaschuso.so.ch/gibsso'
        }
    ]);
});

test('merge mandators canonicalizes aliases and keeps best description', () => {
    expect(mergeMandatorLists(
        [
            {
                name: 'kbssogr',
                description: 'kbssogr',
                url: 'https://kaschuso.so.ch/kbssogr'
            }
        ],
        [
            {
                name: 'kbsso',
                description: 'Kaufmaennische Berufsfachschule Solothurn',
                url: 'https://kaschuso.so.ch/kbsso'
            }
        ]
    )).toEqual([
        {
            name: 'kbsso',
            description: 'Kaufmaennische Berufsfachschule Solothurn',
            url: 'https://kaschuso.so.ch/kbsso'
        }
    ]);
});

test('get absences from html', async () => {
    const html = fs.readFileSync('./__test__/absences.html', 'utf8');
    expect(await getAbsencesFromHtml(html))
    .toEqual([
        {
            "date": "30.03.2021",
            "time": "13:50 - 14:35",
            "class": "M326-INF17A,INF17B-MOSD",
            "status": "Entschuldigt",
            "comment": "Krank Erkältung",
            "reason": "Interview mit der FHNW",
        },
        {
            "date": "30.03.2021",
            "time": "14:40 - 15:25",
            "class": "M326-INF17A,INF17B-MOSD",
            "status": "Unentschuldigt",
            "reason": "Krank",
        },
        {
            "date": "11.03.2020",
            "time": "13:50 - 14:35",
            "class": "M151-INF17A-MOSD",
            "status": "Nicht zählend",
        },
        {
            "date": "15.03.2019",
            "time": "08:25 - 09:10",
            "class": "M151-INF17A-MOSD",
            "status": "offen",
            "comment": "Zahnarztbesuch",
            "reason": "Rektruktierung",
        },
        {
            "date": "15.03.2019",
            "time": "09:15 - 10:00",
            "class": "HUSO-BM1_TE31A-LOMA",
            "status": "Unentschuldigt",
            "reason": "Verschlafen",
        },
    ]);
});

test('get grades from html', async () => {
    const html = fs.readFileSync('./__test__/grades.html', 'utf8');
    expect(await getGradesFromHtml(html))
    .toEqual([
        {
            "class": "D-BM1_TE17A-GEIM",
            "name": "Deutsch",
            "average": "4.875",
            "grades": [
                {
                    "date": "22.03.2021",
                    "name": "Schachnovelle",
                    "value": "5.25",
                    "points": "12",
                    "weighting": "1",
                    "average": "4.781"
                },
                {
                    "date": "08.04.2021",
                    "name": "Literaturgeschichte",
                    "value": "4.5",
                    "points": "18",
                    "weighting": "1",
                    "average": "4.617"
                }
            ]
        },
        {
            "class": "M326-INF17A,INF17B-MOSD",
            "name": "M326 Objektorientiert entwerfen und implementieren",
            "average": "6.000",
            "grades": [
                {
                    "date": "30.03.2021",
                    "name": "Anwendung Projekt M306",
                    "value": "6",
                    "points": "21",
                    "weighting": "1",
                    "average": "5.459"
                }
            ]
        },
        {
            "class": "MS-BM1_TE17A-HARS",
            "name": "Mathematik Schwerpunkt",
            "average": "4.700",
            "grades": [
                {
                    "date": "18.03.2021",
                    "name": "Skalarprodukt",
                    "value": "4.7",
                    "points": "8",
                    "weighting": "1",
                    "average": "4.138"
                }
            ]
        },
        {
            "class": "PH-BM1_TE17A-HARS",
            "name": "Physik",
            "average": "5.763",
            "grades": [
                {
                    "date": "29.01.2021",
                    "name": "Noise-Cancelling",
                    "value": "5.625",
                    "weighting": "1",
                    "average": "4.875"
                },
                {
                    "date": "26.03.2021",
                    "name": "Schwingungen",
                    "value": "5.9",
                    "points": "17",
                    "weighting": "1",
                    "average": "4.6"
                }
            ]
        }
    ]);
});

test('get user info from html', async () => {
    const homeHtml = fs.readFileSync('./__test__/start.html', 'utf8');
    const settingsHtml = fs.readFileSync('./__test__/settings.html', 'utf8');
    expect(await getUserInfoFromHtml(homeHtml, settingsHtml, "school", "vorname.nachname"))
    .toEqual({
        "mandator": "school",
        "username": "vorname.nachname",
        "name": "Nachname Vorname",
        "address": "Hauptstrasse 1",
        "zipCity": "9000 St. Gallen",
        "birthdate": "11.09.2001",
        "education": "Gringverdiener EFZ - Systemer / VWB abbroche",
        "hometown": "St. Gallen",
        "phone": "+41 32 627 78 00",
        "mobile": "+41 79 420 69 69",
        "email": "vorname.nachname@bbzsogr.ch",
        "privateEmail": "vorname.nachname@gmail.com"
    });
});

test('get current requested page from html', async () => {
    const html = fs.readFileSync('./__test__/login.html', 'utf8');
    expect(getCurrentRequestedPageFromHtml(html))
    .toBe('LcLjlOlhylNbKRBT%2BWI6BQ%3D%3D');
});

test('build login payload from html form', async () => {
    const html = fs.readFileSync('./__test__/login.html', 'utf8');
    expect(getLoginPayloadFromHtml(html, 'john.doe', 'secret')).toEqual({
        userid: 'john.doe',
        password: 'secret',
        currentRequestedPage: 'LcLjlOlhylNbKRBT%2BWI6BQ%3D%3D'
    });
});

test('get action from ses.js', async () => {
    const html = fs.readFileSync('./__test__/ses.js', 'utf8');
    expect(getActionFromSesJs(html))
    .toMatch(/^auth\?8C3C82CB56AE=[\da-f]{32}$/);
});

test('classify auth failure with redirect as invalid credentials', () => {
    expect(getAuthenticationFailureInfo({
        name: 'AuthenticationError',
        authDiagnostics: {
            hasLocationHeader: true
        }
    })).toEqual({
        reason: 'INVALID_CREDENTIALS',
        detail: 'The upstream login did not accept the provided credentials.'
    });
});

test('classify auth failure without redirect as upstream change', () => {
    expect(getAuthenticationFailureInfo({
        name: 'AuthenticationError',
        authDiagnostics: {
            hasLocationHeader: false,
            hasCredentialError: false
        }
    })).toEqual({
        reason: 'UPSTREAM_RESPONSE_CHANGED',
        detail: 'The upstream login did not return a valid authenticated session.'
    });
});

test('classify auth failure with inline credential error as invalid credentials', () => {
    expect(getAuthenticationFailureInfo({
        name: 'AuthenticationError',
        authDiagnostics: {
            hasLocationHeader: false,
            hasCredentialError: true,
            credentialErrorText: 'Zugriff verweigert. Ungültiger Benutzername oder falsches Passwort.'
        }
    })).toEqual({
        reason: 'INVALID_CREDENTIALS',
        detail: 'The upstream login did not accept the provided credentials.'
    });
});

test('classify auth failure for invalid credentials', () => {
    const error = new Error('username or password invalid');
    error.name = 'AuthenticationError';

    expect(getAuthenticationFailureInfo(error)).toEqual({
        reason: 'UPSTREAM_RESPONSE_CHANGED',
        detail: 'The upstream login did not return a valid authenticated session.'
    });
});

test('classify auth failure for upstream timeout', () => {
    const error = new Error('timeout');
    error.code = 'ECONNABORTED';

    expect(getAuthenticationFailureInfo(error)).toEqual({
        reason: 'UPSTREAM_TIMEOUT',
        detail: 'The upstream login service did not respond in time.'
    });
});

test('classify auth failure for parse mismatch', () => {
    const error = new TypeError('Cannot read properties of null');

    expect(getAuthenticationFailureInfo(error)).toEqual({
        reason: 'UPSTREAM_RESPONSE_CHANGED',
        detail: 'The upstream login page format could not be parsed.'
    });
});
