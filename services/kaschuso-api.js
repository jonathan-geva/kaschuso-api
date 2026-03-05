const cryptoRandomString = require('crypto-random-string');

const axios = require('axios').default;
axios.defaults.withCredentials = true;

const qs = require('qs');
const cheerio = require('cheerio');

const BASE_URL   = process.env.KASCHUSO_BASE_URL || 'https://kaschuso.so.ch/';
const FORM_URL   = BASE_URL + 'login/sls/auth?RequestedPage=%2f';
const LOGIN_URL  = BASE_URL + 'login/sls/';
const SES_JS_URL = BASE_URL + 'sil-bid-check/ses.js';


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

    let loginHeaders = Object.assign({}, headers);
    loginHeaders['Content-Type'] = 'application/x-www-form-urlencoded';

    // make login
    const loginRes = await axios.post(LOGIN_URL + getActionFromSesJs(sesJS.data), 
        qs.stringify({
            userid: username,
            password: password,
            currentRequestedPage: getCurrentRequestedPageFromHtml(formRes.data)
        }),
        {
            withCredentials: true,
            headers: loginHeaders,
            maxRedirects: 0
        }
    );
    
    if (!loginRes.cookies['SCDID_S']) {
        const error =  new Error('username or password invalid');
        error.name = 'AuthenticationError';
        throw error;
    }
    
    cookies = { ...cookies, ...loginRes.cookies };
    
    storeCookies(mandator, username, cookies);

    return cookies;
}

function getCurrentRequestedPageFromHtml(html) {
    return cheerio.load(html)('input[name=currentRequestedPage]').attr('value');
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

    let headers = Object.assign({}, DEFAULT_HEADERS);
    headers['Cookie'] = toCookieHeaderString(await basicAuthenticate());

    return await axios.get(BASE_URL, {
            withCredentials: true,
            headers: headers,
            maxRedirects: 5
        }).then(res => getMandatorsFromHtml(res.data));
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

function storeCookies(cookiesMap, mandator, username, cookies) {
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

function getCookiesFromHeaders(headers) {
    const cookies = {};
    if (headers['set-cookie']) {
        headers['set-cookie'].forEach(cookie => {
            const keyValue = cookie.split(';')[0].split('=');
            cookies[keyValue[0]] = keyValue[1];
        });
    }
    return cookies;
}

axios.interceptors.response.use((response) => {
    response.cookies = getCookiesFromHeaders(response.headers);
    return response;
}, (error) => {
    if (error.response.status === 302) {
        const cookies = getCookiesFromHeaders(error.response.headers);
        const locationValue = error.response.headers.location;
        return Promise.resolve({error, cookies, locationValue});
    }
    return Promise.reject(error);
});

module.exports = {
    authenticate,
    getUserInfo,
    getGrades,
    getAbsences,
    getMandators,
    // for testing 
    getCookiesFromHeaders,
    toCookieHeaderString,
    findUrlByPageid,
    getMandatorsFromHtml,
    getAbsencesFromHtml,
    getGradesFromHtml,
    getUserInfoFromHtml,
    getCurrentRequestedPageFromHtml,
    getActionFromSesJs
};