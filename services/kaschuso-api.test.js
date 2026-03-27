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
    getUnconfirmedGradesFromHtml,
    getUserInfoFromHtml,
    getCurrentRequestedPageFromHtml,
    getLoginPayloadFromHtml,
    getActionFromSesJs,
    getAuthenticationFailureInfo,
    hasAuthenticatedSessionCookie,
    mergeCookies,
    getPortalMetadata
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
            "class": "COURSE-DELTA",
            "status": "Entschuldigt",
            "comment": "Krank Erkältung",
            "reason": "Interview mit der FHNW",
        },
        {
            "date": "30.03.2021",
            "time": "14:40 - 15:25",
            "class": "COURSE-DELTA",
            "status": "Unentschuldigt",
            "reason": "Krank",
        },
        {
            "date": "11.03.2020",
            "time": "13:50 - 14:35",
            "class": "COURSE-INDIA",
            "status": "Nicht zählend",
        },
        {
            "date": "15.03.2019",
            "time": "08:25 - 09:10",
            "class": "COURSE-INDIA",
            "status": "offen",
            "comment": "Zahnarztbesuch",
            "reason": "Rektruktierung",
        },
        {
            "date": "15.03.2019",
            "time": "09:15 - 10:00",
            "class": "COURSE-JULIET",
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
            "class": "COURSE-BRAVO",
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
            "class": "COURSE-DELTA",
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
            "class": "COURSE-ECHO",
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
            "class": "COURSE-FOXTROT",
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

test('get grades from modern layout with 4-column detail rows', async () => {
        const html = `
        <div id="uebersicht_bloecke">
            <page>
                <div>
                    <table class="mdl-data-table mdl-table--listtable">
                        <tbody>
                            <tr>
                                <td><b>COURSE-FOXTROT</b><br>Mathematik</td>
                                <td>4.700</td>
                            </tr>
                            <tr class="0_9_detailrow" style="display:none;">
                                <td colspan="5">
                                    <table class="clean">
                                        <tr>
                                            <td><i>Datum</i></td><td><i>Thema</i></td><td><i>Bewertung</i></td><td><i>Gewichtung</i></td>
                                        </tr>
                                        <tr>
                                            <td>13.02.2026</td>
                                            <td>Statistik und Kombinatorik</td>
                                            <td>3.9</td>
                                            <td>1</td>
                                        </tr>
                                        <tr>
                                            <td>08.05.2026</td>
                                            <td>Wahrscheinlichkeitsrechnung</td>
                                            <td></td>
                                            <td>1</td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </page>
        </div>`;

        expect(await getGradesFromHtml(html)).toEqual([
                {
                        class: 'COURSE-FOXTROT',
                        name: 'Mathematik',
                        average: '4.700',
                        grades: [
                                {
                                        date: '13.02.2026',
                                        name: 'Statistik und Kombinatorik',
                                        value: '3.9',
                                        points: undefined,
                                        weighting: '1',
                                    average: undefined
                                }
                        ]
                }
        ]);
});

test('get grades from modern layout includes all subjects with varied detail row classes', async () => {
    const html = `
    <div id="uebersicht_bloecke">
        <table class="mdl-data-table mdl-table--listtable">
            <tbody>
                <tr>
                    <td><b>COURSE-ALPHA</b><br>Englisch</td>
                    <td>5.976</td>
                </tr>
                <tr class="0_9_detailrow" style="display:none;">
                    <td colspan="5">
                        <table class="clean">
                            <tr><td><i>Datum</i></td><td><i>Thema</i></td><td><i>Bewertung</i></td><td><i>Gewichtung</i></td></tr>
                            <tr><td>21.01.2026</td><td>Vocabulary EFI File 2A</td><td>6</td><td>0.5</td></tr>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td><b>COURSE-BRAVO</b><br>Franzoesisch</td>
                    <td>4.779</td>
                </tr>
                <tr class="1_9_detailrow" style="display:none;">
                    <td colspan="5">
                        <table class="clean">
                            <tr><td><i>Datum</i></td><td><i>Thema</i></td><td><i>Bewertung</i></td><td><i>Gewichtung</i></td></tr>
                            <tr><td>17.02.2026</td><td>Jeu de role</td><td>5.25</td><td>0.5</td></tr>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td><b>COURSE-CHARLIE</b><br>Geschichte und Politik</td>
                    <td>5.714</td>
                </tr>
                <tr class="2_9_detailrow" style="display:none;">
                    <td colspan="5">
                        <table class="clean">
                            <tr><td><i>Datum</i></td><td><i>Thema</i></td><td><i>Bewertung</i></td><td><i>Gewichtung</i></td></tr>
                            <tr><td>18.02.2026</td><td>Aufstieg und Herrschaft</td><td>5.6</td><td>0.5</td></tr>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td><b>COURSE-DELTA</b><br>M254 Geschaeftsprozesse im eigenen Berufsumfeld beschreiben</td>
                    <td>5.500</td>
                </tr>
                <tr class="detail-row" style="display:none;">
                    <td colspan="5">
                        <table class="clean">
                            <tr><td><i>Datum</i></td><td><i>Thema</i></td><td><i>Bewertung</i></td><td><i>Gewichtung</i></td></tr>
                            <tr>
                                <td>19.03.2026</td>
                                <td>Kurztest Aufbau-Ablauforganisation</td>
                                <td>6<span><i class='far fa-info-circle'></i></span><div><b>Details zur Note</b><br>Punkte: 15.5</div></td>
                                <td>0.5</td>
                            </tr>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td><b>COURSE-ECHO</b><br>Mathematik Grundlagen</td>
                    <td>4.900</td>
                </tr>
                <tr class="mg_detail" style="display:none;">
                    <td colspan="5">
                        <table class="clean">
                            <tr><td><i>Datum</i></td><td><i>Thema</i></td><td><i>Bewertung</i></td><td><i>Gewichtung</i></td></tr>
                            <tr>
                                <td>04.03.2026</td>
                                <td>MA-Planimetrie</td>
                                <td>4.9<span><i class='far fa-info-circle'></i></span><div><b>Details zur Note</b><br>Punkte: 16.5</div></td>
                                <td>1</td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>`;

    const grades = await getGradesFromHtml(html);
    expect(grades.map(subject => subject.class)).toEqual([
        'COURSE-ALPHA',
        'COURSE-BRAVO',
        'COURSE-CHARLIE',
        'COURSE-DELTA',
        'COURSE-ECHO'
    ]);

    expect(grades.find(subject => subject.class === 'COURSE-DELTA').grades[0].points).toBe('15.5');
    expect(grades.find(subject => subject.class === 'COURSE-ECHO').grades[0].points).toBe('16.5');
});

test('get unconfirmed grades from html', async () => {
    const html = fs.readFileSync('./__test__/start.html', 'utf8');
    expect(await getUnconfirmedGradesFromHtml(html))
    .toEqual([
        {
            "subject": "COURSE-BRAVO",
            "name": "Literaturgeschichte",
            "date": "08.04.2021",
            "value": "4.5"
        },
        {
            "subject": "COURSE-DELTA",
            "name": "Anwendung Projekt M306",
            "date": "30.03.2021",
            "value": "6"
        },
        {
            "subject": "COURSE-FOXTROT",
            "name": "Schwingungen",
            "date": "26.03.2021",
            "value": "5.9"
        },
        {
            "subject": "COURSE-BRAVO",
            "name": "Schachnovelle",
            "date": "22.03.2021",
            "value": "5.25"
        },
        {
            "subject": "COURSE-ECHO",
            "name": "Skalarprodukt",
            "date": "18.03.2021",
            "value": "3.7"
        },
        {
            "subject": "COURSE-FOXTROT",
            "name": "Noise-Cancelling",
            "date": "29.01.2021",
            "value": "5.625"
        }
    ]);
});

test('get absences from modern summary table layout', async () => {
        const html = `
        <h4>Absenzauszug - W</h4>
        <table class="mdl-data-table mdl-js-data-table mdl-table--listtable">
            <tr>
                <th>Datum von</th><th>Datum bis</th><th>Grund</th><th></th><th>Absenzpunkte</th>
            </tr>
            <tr style="color: #df8d06;">
                <td>26.01.2026</td>
                <td>04.02.2026</td>
                <td></td>
                <td></td>
                <td><span>10</span></td>
            </tr>
            <tr style="color: #df8d06;">
                <td>13.02.2026</td>
                <td>13.02.2026</td>
                <td>Arzt</td>
                <td></td>
                <td><span>3</span></td>
            </tr>
        </table>`;

        expect(await getAbsencesFromHtml(html)).toEqual({
            absences: [
                {
                    date: '26.01.2026',
                    reason: undefined,
                    status: 'Absence points',
                    period: '26.01.2026 - 04.02.2026',
                    subject: '-',
                    points: '10',
                    untilDate: '04.02.2026'
                },
                {
                    date: '13.02.2026',
                    reason: 'Arzt',
                    status: 'Absence points',
                    period: '13.02.2026',
                    subject: '-',
                    points: '3',
                    untilDate: '13.02.2026'
                }
            ],
            pointsSummary: {
                total: null,
                remaining: null,
                used: null
            },
            incidents: [
                {
                    date: '26.01.2026',
                    untilDate: '04.02.2026',
                    reason: undefined,
                    points: '10'
                },
                {
                    date: '13.02.2026',
                    untilDate: '13.02.2026',
                    reason: 'Arzt',
                    points: '3'
                }
            ],
            openReports: [],
            tardiness: [],
            missedExams: null,
            tardinessSummary: {
                excused: null,
                unexcused: null
            }
        });
});

test('get absences from SAL point-based layout with open reports and tardiness', async () => {
    const html = `
    <div>
        <h4>Absenzauszug - W</h4>
        <table class="mdl-data-table mdl-js-data-table mdl-table--listtable">
            <tr><th>Datum von</th><th>Datum bis</th><th>Grund</th><th></th><th>Absenzpunkte</th></tr>
            <tr><td>26.01.2026</td><td>04.02.2026</td><td></td><td></td><td>10</td></tr>
            <tr><td>13.02.2026</td><td>13.02.2026</td><td>Arzt</td><td></td><td>3</td></tr>
        </table>
        <div>Anzahl Ereignisse: 2</div>
        <div>Kontingent: 30</div>
        <div>Verbleibendes Kontingent: 17</div>
        <div>Verpasste Prüfungen: 1</div>

        <h4>Offene Absenzmeldungen</h4>
        <table class="mdl-data-table mdl-js-data-table mdl-table--listtable">
            <tr><th>Datum</th><th>Zeit</th><th>Kurs</th></tr>
            <tr><td>12.03.2026</td><td>07:45 - 08:30</td><td>COURSE-ALPHA</td></tr>
        </table>

        <h4>Verspätungen</h4>
        <table class="mdl-data-table mdl-js-data-table mdl-table--listtable">
            <tr><th>Datum</th><th>Lektion</th><th>Grund</th><th>Zeitspanne</th><th>Entschuldigt</th></tr>
            <tr><td>19.12.2025</td><td>09:35</td><td></td><td>5</td><td>Nein</td></tr>
        </table>
        <div>Entschuldigt: 0</div>
        <div>Unentschuldigt: 1</div>
    </div>`;

    expect(await getAbsencesFromHtml(html)).toEqual({
        absences: [
            {
                date: '26.01.2026',
                reason: undefined,
                status: 'Absence points',
                period: '26.01.2026 - 04.02.2026',
                subject: '-',
                points: '10',
                untilDate: '04.02.2026'
            },
            {
                date: '13.02.2026',
                reason: 'Arzt',
                status: 'Absence points',
                period: '13.02.2026',
                subject: '-',
                points: '3',
                untilDate: '13.02.2026'
            }
        ],
        pointsSummary: {
            total: 30,
            remaining: 17,
            used: 13
        },
        incidents: [
            {
                date: '26.01.2026',
                untilDate: '04.02.2026',
                reason: undefined,
                points: '10'
            },
            {
                date: '13.02.2026',
                untilDate: '13.02.2026',
                reason: 'Arzt',
                points: '3'
            }
        ],
        openReports: [
            {
                date: '12.03.2026',
                time: '07:45 - 08:30',
                course: 'COURSE-ALPHA'
            }
        ],
        tardiness: [
            {
                date: '19.12.2025',
                lesson: '09:35',
                reason: undefined,
                timespan: '5',
                excused: 'Nein'
            }
        ],
        missedExams: 1,
        tardinessSummary: {
            excused: 0,
            unexcused: 1
        }
    });
});

test('get absences from SAL layout ignores nested detail tables and keeps contingent values', async () => {
    const html = `
    <div>
        <h3>Absenzenauszug - W</h3>
        <table class="mdl-data-table mdl-table--listtable">
            <tbody>
                <tr><th>Datum von</th><th>Datum bis</th><th>Grund</th><th>Absenzpunkte</th></tr>
                <tr><td>26.01.2026</td><td>04.02.2026</td><td></td><td>10</td></tr>
                <tr>
                    <td colspan="4">
                        Zu dieser Absenz erfassten Meldungen:
                        <table>
                            <tr><td>29.01.2026</td><td>10:35 - 11:20</td><td>COURSE-ALPHA</td></tr>
                            <tr><td>30.01.2026</td><td>11:30 - 12:15</td><td>COURSE-BRAVO</td></tr>
                        </table>
                    </td>
                </tr>
                <tr><td>13.02.2026</td><td>13.02.2026</td><td></td><td>3</td></tr>
            </tbody>
        </table>

        <table>
            <tbody>
                <tr><td>Anzahl Ereignisse:</td><td>2</td><td>Kontingent:</td><td>30</td></tr>
                <tr><td>Verbleibendes Kontingent:</td><td>17</td></tr>
            </tbody>
        </table>

        <div>Verpasste Prüfungen: 1</div>
        <table class="mdl-data-table mdl-table--listtable">
            <tbody>
                <tr><th>Kurs</th><th>Datum</th><th>Lektion</th></tr>
                <tr><td>COURSE-INDIA</td><td>30.01.2026</td><td>10:35 - 11:20</td></tr>
            </tbody>
        </table>

        <h4>Offene Absenzmeldungen</h4>
        <table class="mdl-data-table mdl-table--listtable">
            <tbody>
                <tr><th>Datum</th><th>Zeit</th><th>Kurs</th></tr>
                <tr><td>12.03.2026</td><td>07:45 - 08:30</td><td>COURSE-CHARLIE</td></tr>
                <tr><td>12.03.2026</td><td>08:40 - 09:25</td><td>COURSE-CHARLIE</td></tr>
            </tbody>
        </table>

        <h4>Verspätungen</h4>
        <table class="mdl-data-table mdl-table--listtable">
            <tbody>
                <tr><th>Datum</th><th>Lektion</th><th>Grund</th><th>Zeitspanne</th><th>Entschuldigt</th></tr>
                <tr><td>Fr, 19.12.2025</td><td>09:35</td><td></td><td>5</td><td>Nein</td></tr>
            </tbody>
        </table>
        <table>
            <tbody>
                <tr><td>Entschuldigt:</td><td>0</td></tr>
                <tr><td>Unentschuldigt:</td><td>1</td></tr>
            </tbody>
        </table>
    </div>`;

    expect(await getAbsencesFromHtml(html)).toEqual({
        absences: [
            {
                date: '26.01.2026',
                reason: undefined,
                status: 'Absence points',
                period: '26.01.2026 - 04.02.2026',
                subject: '-',
                points: '10',
                untilDate: '04.02.2026',
                details: [
                    {
                        date: '29.01.2026',
                        time: '10:35 - 11:20',
                        course: 'COURSE-ALPHA'
                    },
                    {
                        date: '30.01.2026',
                        time: '11:30 - 12:15',
                        course: 'COURSE-BRAVO'
                    }
                ]
            },
            {
                date: '13.02.2026',
                reason: undefined,
                status: 'Absence points',
                period: '13.02.2026',
                subject: '-',
                points: '3',
                untilDate: '13.02.2026'
            }
        ],
        pointsSummary: {
            total: 30,
            remaining: 17,
            used: 13
        },
        incidents: [
            {
                date: '26.01.2026',
                untilDate: '04.02.2026',
                reason: undefined,
                points: '10',
                details: [
                    {
                        date: '29.01.2026',
                        time: '10:35 - 11:20',
                        course: 'COURSE-ALPHA'
                    },
                    {
                        date: '30.01.2026',
                        time: '11:30 - 12:15',
                        course: 'COURSE-BRAVO'
                    }
                ]
            },
            {
                date: '13.02.2026',
                untilDate: '13.02.2026',
                reason: undefined,
                points: '3'
            }
        ],
        openReports: [
            {
                date: '12.03.2026',
                time: '07:45 - 08:30',
                course: 'COURSE-CHARLIE'
            },
            {
                date: '12.03.2026',
                time: '08:40 - 09:25',
                course: 'COURSE-CHARLIE'
            }
        ],
        tardiness: [
            {
                date: '19.12.2025',
                lesson: '09:35',
                reason: undefined,
                timespan: '5',
                excused: 'Nein'
            }
        ],
        missedExams: 1,
        tardinessSummary: {
            excused: 0,
            unexcused: 1
        }
    });
});

test('derive tardiness summary from rows when explicit counters are 0', async () => {
    const html = `
    <div>
        <h4>Verspätungen</h4>
        <table class="mdl-data-table mdl-table--listtable">
            <tbody>
                <tr><th>Datum</th><th>Lektion</th><th>Grund</th><th>Zeitspanne</th><th>Entschuldigt</th></tr>
                <tr><td>19.12.2025</td><td>09:35</td><td></td><td>5</td><td>Nein</td></tr>
            </tbody>
        </table>
        <div>Entschuldigt: 0</div>
        <div>Unentschuldigt: 0</div>
    </div>`;

    expect(await getAbsencesFromHtml(html)).toMatchObject({
        tardiness: [
            {
                date: '19.12.2025',
                lesson: '09:35',
                timespan: '5',
                excused: 'Nein'
            }
        ],
        tardinessSummary: {
            excused: 0,
            unexcused: 1
        }
    });
});

test('get user info from html', async () => {
    const homeHtml = fs.readFileSync('./__test__/start.html', 'utf8');
    const settingsHtml = fs.readFileSync('./__test__/settings.html', 'utf8');
    const result = await getUserInfoFromHtml(homeHtml, settingsHtml, 'school', 'student.user');

    expect(result).toMatchObject({
        mandator: 'school',
        username: 'student.user'
    });

    expect(result.name).toEqual(expect.any(String));
    expect(result.address).toEqual(expect.any(String));
    expect(result.zipCity).toEqual(expect.any(String));
    expect(result.birthdate).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(result.phone).toMatch(/^\+\d{2}/);
    expect(result.mobile).toMatch(/^\+\d{2}/);
    expect(result.email).toContain('@');
    expect(result.privateEmail).toContain('@');
});

test('get user info from SAL html label variants', async () => {
    const homeHtml = `
        <div id="content-card">
            <div>
                <div>
                    <table>
                        <tbody>
                            <tr><td>Name Vorname</td><td>Test Student</td></tr>
                            <tr><td>Strasse</td><td>Example Street 12</td></tr>
                            <tr><td>PLZ Ort</td><td>0000 Placeholder City</td></tr>
                            <tr><td>Geburtsdatum</td><td>01.01.2000</td></tr>
                            <tr><td>Profil</td><td>Schwerpunkt Wirtschaft und Recht</td></tr>
                            <tr><td>Heimatort</td><td>Placeholder Hometown</td></tr>
                            <tr><td>Telefon</td><td>000 000 00 00</td></tr>
                            <tr><td>Mobiltelefon</td><td>000 000 00 01</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const settingsHtml = `
        <form>
            <input id="f0" value="" />
            <input id="f1" value="student@example.com" />
        </form>
    `;

    const result = await getUserInfoFromHtml(homeHtml, settingsHtml, 'gymli', 'e265218');

    expect(result).toMatchObject({
        mandator: 'gymli',
        username: 'e265218',
        name: 'Test Student',
        address: 'Example Street 12',
        zipCity: '0000 Placeholder City',
        birthdate: '01.01.2000',
        education: 'Schwerpunkt Wirtschaft und Recht',
        hometown: 'Placeholder Hometown',
        phone: '000 000 00 00',
        mobile: '000 000 00 01',
        email: '',
        privateEmail: 'student@example.com'
    });
});

test('get current requested page from html', async () => {
    const html = fs.readFileSync('./__test__/login.html', 'utf8');
    expect(getCurrentRequestedPageFromHtml(html))
    .toBe('LcLjlOlhylNbKRBT%2BWI6BQ%3D%3D');
});

test('build login payload from html form', async () => {
    const html = fs.readFileSync('./__test__/login.html', 'utf8');
    expect(getLoginPayloadFromHtml(html, 'test.user', 'test-secret')).toEqual({
        userid: 'test.user',
        password: 'test-secret',
        currentRequestedPage: expect.any(String)
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

test('expose publish metadata for upstream portals', () => {
    expect(getPortalMetadata()).toMatchObject({
        features: {
            salPortal: expect.any(Boolean)
        },
        upstreams: {
            legacy: {
                baseUrl: expect.stringMatching(/^https?:\/\//)
            },
            sal: {
                baseUrl: expect.stringMatching(/^https?:\/\//),
                enabled: expect.any(Boolean),
                mandators: expect.any(Array)
            }
        }
    });
});
