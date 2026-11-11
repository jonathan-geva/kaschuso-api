const { createGradeHistoryService, parseSemesterPage, validateSemesterIds } = require('./grade-history');
const { getGradesFromHtml } = require('./kaschuso-api');
const { runAccount } = require('./account-queue');

const NOW = Date.UTC(2026, 10, 10);
const OPTIONS = [
    { id: '41', label: '2.25/26' },
    { id: '43', label: '2.26/27' },
    { id: '40', label: '1.25/26' },
    { id: '42', label: '1.26/27' }
];

function page(selected = '42', token = 'synthetic1', options = OPTIONS, content = '') {
    return `<select id="sem" onchange="xajax_save_semid(this.value, 'index.php?pageid=21311&amp;id=synthetic&amp;transid=${token}&amp;listindex_s=');">${options.map(option =>
        `<option value="${option.id}"${option.id === selected ? ' selected' : ''}>${option.label}</option>`
    ).join('')}</select><script>var xajaxRequestUri = "https://kaschuso.so.ch/gibsso/xajax_js.php?pageid=21311&id=synthetic&transid=${token}";</script>
    <div id="uebersicht_bloecke">${content}</div>`;
}

function gradeTable(name, value) {
    return `<table class="mdl-table--listtable"><tbody><tr><td><b>SYNTHETIC-CLASS</b><br>${name}</td><td>${value}</td></tr>
        <tr><td><table class="clean"><tr><td></td><td>01.09.2026</td><td>Synthetic assessment</td><td>${value}</td><td>1</td><td>4.0</td></tr></table></td></tr></tbody></table>`;
}

// An in-memory upstream implements selection, rotating navigation metadata and
// independent account sessions. No network or private school fixtures are used.
function portal(overrides = {}) {
    const states = new Map();
    const events = [];
    let opens = 0;
    const openSession = async (mandator, username) => {
        opens++;
        if (!states.has(username)) states.set(username, { selected: '42', token: 0 });
        const state = states.get(username);
        return {
            homeHtml: `<a href="index.php?pageid=21311&amp;id=synthetic&amp;transid=synthetic${state.token}">Grades</a>`,
            async request({ method, url, body }) {
                const target = new URL(url);
                if (target.origin !== 'https://kaschuso.so.ch' || !target.pathname.startsWith('/gibsso/')) throw new Error('Unsafe request');
                if (target.searchParams.get('transid') !== `synthetic${state.token}`) throw new Error('Stale metadata');
                events.push({ username, method, selected: state.selected });
                if (overrides.onRequest) await overrides.onRequest({ username, method, state });
                if (method === 'POST') {
                    const form = new URLSearchParams(body);
                    if (form.get('xajax') !== 'save_semid' || !/^\d+$/.test(form.get('xajaxr'))) throw new Error('Incorrect action');
                    const [id, returnLink] = form.getAll('xajaxargs[]');
                    if (new URL(returnLink, 'https://kaschuso.so.ch/gibsso/').searchParams.get('transid') !== `synthetic${state.token}`) throw new Error('Stale return link');
                    if (!OPTIONS.some(option => option.id === id) && !overrides.options?.some(option => option.id === id)) throw new Error('Unknown semester');
                    if (overrides.failSelect?.(id, state)) throw new Error('Synthetic upstream failure with https://private.invalid/synthetic');
                    if (!overrides.ignoreSelect?.(id, state)) state.selected = id;
                    return '<xjx></xjx>';
                }
                if (overrides.failRead?.(state)) throw new Error('Synthetic upstream response with private markup');
                state.token++;
                return overrides.html?.(state) || page(state.selected, `synthetic${state.token}`, overrides.options || OPTIONS,
                    state.selected === '40' ? '' : gradeTable(username === 'alpha' ? 'Deutsch' : 'Englisch', state.selected === '42' ? '5.0' : '4.5'));
            }
        };
    };
    const service = createGradeHistoryService({ openSession, parseGrades: getGradesFromHtml, runAccount, now: overrides.now || (() => NOW) });
    return { service, states, events, get opens() { return opens; } };
}

test('parses the selected semester, filters future catalogue options and orders newest first', () => {
    const parsed = parseSemesterPage(page(), 'gibsso', NOW);
    expect(parsed.availableSemesters).toEqual([
        { id: '42', label: '1.26/27', isCurrent: true },
        { id: '41', label: '2.25/26', isCurrent: false },
        { id: '40', label: '1.25/26', isCurrent: false }
    ]);
    expect(parsed.selectedSemester).toEqual({ id: '42', label: '1.26/27' });
});

test('preserves only safe authentication classification when school credentials are rejected', async () => {
    const original = new Error('SYNTHETIC_PRIVATE_DIAGNOSTICS');
    original.name = 'AuthenticationError';
    original.authDiagnostics = { hasCredentialError: true, rawHtml: 'SYNTHETIC_PRIVATE_HTML' };
    const service = createGradeHistoryService({ openSession: async () => { throw original; }, parseGrades: getGradesFromHtml, runAccount });
    let failure;
    try { await service.getGradeHistory('gibsso', 'synthetic', 'SYNTHETIC_PASSWORD'); } catch (error) { failure = error; }
    expect(require('./kaschuso-api').getAuthenticationFailureInfo(failure).reason).toBe('INVALID_CREDENTIALS');
    expect(failure.message).not.toContain('SYNTHETIC_PRIVATE');
    expect(JSON.stringify(failure)).not.toContain('SYNTHETIC_PRIVATE');
    expect(failure.authDiagnostics).toEqual({ hasCredentialError: true, hasLocationHeader: false });
});

test('accepts spaced portal labels and a request URI declaration without a trailing semicolon', () => {
    const html = page().replaceAll(/([12])\.(\d{2})\//g, '$1. $2/').replace('transid=synthetic1";', 'transid=synthetic1"');
    const parsed = parseSemesterPage(html, 'gibsso', NOW);
    expect(parsed.selectedSemester).toEqual({ id: '42', label: '1. 26/27' });
    expect(parsed.availableSemesters.map(semester => semester.id)).toEqual(['42', '41', '40']);
});

test.each([
    html => html.replace('https://kaschuso.so.ch/gibsso/xajax_js.php', 'https://evil.invalid/gibsso/xajax_js.php'),
    html => html.replace('index.php?pageid', '../other/index.php?pageid'),
    html => html.replace('xajax_save_semid(this.value,', 'arbitrary(this.value,'),
    html => html.replace('value="41"', 'value="42"'),
    html => html.replace('1.26/27', 'Unrecognised term'),
    html => html.replace(' selected', ''),
    html => html.replace('<div id="uebersicht_bloecke">', '<div id="other">')
])('rejects unsupported or untrusted markup before semester changes', mutate => {
    expect(() => parseSemesterPage(mutate(page()), 'gibsso', NOW)).toThrow('Grade history is unavailable.');
});

test.each([[], Array(9).fill('42'), ['42', '42'], ['42', '../41'], ['42', ''], '42'])('rejects malformed requested semester IDs: %p', ids => {
    expect(() => validateSemesterIds(ids)).toThrow();
});

test('retrieves explicit history with fresh metadata and restores the initial selection', async () => {
    const upstream = portal();
    const result = await upstream.service.getGradeHistory('gibsso', 'alpha', 'synthetic-secret', { semesterIds: ['41', '40', '42'] });
    expect(result.selectedSemester).toEqual({ id: '42', label: '1.26/27' });
    expect(result.semesters.map(semester => [semester.id, semester.subjects.length])).toEqual([['41', 1], ['40', 0], ['42', 1]]);
    expect(result.semesters[0].subjects).toEqual([{ name: 'Deutsch', average: '4.5', grades: [{ date: '01.09.2026', name: 'Synthetic assessment', value: '4.5', weighting: '1', average: '4.0' }] }]);
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC-CLASS|synthetic-secret|transid|username/);
    expect(upstream.states.get('alpha').selected).toBe('42');
});

test('does not treat global future semesters as enrolment or select future/unknown IDs', async () => {
    const upstream = portal();
    for (const id of ['43', '999']) {
        await expect(upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: [id] })).rejects.toMatchObject({ code: 'INVALID_SEMESTERS' });
    }
    expect(upstream.events.every(event => event.method === 'GET')).toBe(true);
    const result = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw');
    expect(result.semesters.map(semester => semester.id)).toEqual(['42', '41', '40']);
});

test('defaults to at most eight most recent nonfuture semesters', async () => {
    const options = [...OPTIONS, ...Array.from({ length: 8 }, (_, i) => ({ id: String(30 - i), label: `${i % 2 + 1}.${24 - Math.floor(i / 2)}/${25 - Math.floor(i / 2)}` }))];
    const upstream = portal({ options });
    const result = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw');
    expect(result.semesters).toHaveLength(8);
    expect(result.semesters.map(semester => semester.id)).toEqual(['42', '41', '40', '29', '30', '27', '28', '25']);
});

test('restores on an upstream fetch failure and does not cache the failed result', async () => {
    let failOnce = true;
    const upstream = portal({ failRead(state) { if (state.selected === '41' && failOnce) { failOnce = false; return true; } return false; } });
    await expect(upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] })).rejects.toThrow('Grade history is unavailable.');
    expect(upstream.states.get('alpha').selected).toBe('42');
    const result = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] });
    expect(result.semesters[0].id).toBe('41');
    expect(upstream.opens).toBe(2);
});

test('never relabels current grades when an upstream semester switch was ignored', async () => {
    const upstream = portal({ ignoreSelect: id => id === '41' });
    await expect(upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] })).rejects.toThrow('Grade history is unavailable.');
    expect(upstream.states.get('alpha').selected).toBe('42');
});

test('fails closed after restoration mismatch and repairs selection before current grade access', async () => {
    let ignoreRestore = true;
    const upstream = portal({ ignoreSelect: id => id === '42' && ignoreRestore });
    await expect(upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] })).rejects.toThrow('Grade history is unavailable.');
    expect(upstream.states.get('alpha').selected).toBe('41');
    await expect(upstream.service.ensureRestored('gibsso', 'alpha', 'pw')).rejects.toThrow('Grade history is unavailable.');
    ignoreRestore = false;
    await upstream.service.ensureRestored('gibsso', 'alpha', 'pw');
    expect(upstream.states.get('alpha').selected).toBe('42');
    expect((await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] })).selectedSemester.id).toBe('42');
});

test('isolates cached accounts, credentials and selections, copies results and clears on disconnect', async () => {
    const upstream = portal();
    const first = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] });
    first.semesters[0].subjects[0].name = 'Edited by caller';
    const cached = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] });
    expect(cached.semesters[0].subjects[0].name).toBe('Deutsch');
    expect(upstream.opens).toBe(1);
    const other = await upstream.service.getGradeHistory('gibsso', 'beta', 'pw', { semesterIds: ['41'] });
    expect(other.semesters[0].subjects[0].name).toBe('Englisch');
    await upstream.service.getGradeHistory('gibsso', 'alpha', 'different-pw', { semesterIds: ['41'] });
    await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['42'] });
    expect(upstream.opens).toBe(4);
    upstream.service.clearAccount('gibsso', 'alpha');
    await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] });
    expect(upstream.opens).toBe(5);
});

test('serializes whole history reads with existing account operations while other accounts proceed', async () => {
    let release;
    let entered;
    const blocked = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    let hold = true;
    const upstream = portal({ async onRequest({ username, method, state }) {
        if (username === 'alpha' && method === 'GET' && state.selected === '41' && hold) { hold = false; entered(); await blocked; }
    } });
    const history = upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] });
    await started;
    const existing = runAccount('gibsso', 'alpha', () => upstream.states.get('alpha').selected);
    const other = await upstream.service.getGradeHistory('gibsso', 'beta', 'pw', { semesterIds: ['41'] });
    expect(other.semesters[0].subjects[0].name).toBe('Englisch');
    release();
    await history;
    expect(await existing).toBe('42');
});

test('expires cached history after sixty seconds', async () => {
    let timestamp = NOW;
    const upstream = portal({ now: () => timestamp });
    const initial = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['42'] });
    expect(initial.retrievedAt).toBe('2026-11-10T00:00:00.000Z');
    timestamp += 59999;
    const cached = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['42'] });
    expect(cached.retrievedAt).toBe('2026-11-10T00:00:00.000Z');
    expect(upstream.opens).toBe(1);
    timestamp++;
    const refreshed = await upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['42'] });
    expect(refreshed.retrievedAt).toBe('2026-11-10T00:01:00.000Z');
    expect(upstream.opens).toBe(2);
});

test('reopens trusted homepage metadata to restore after a response loses a rotated navigation token', async () => {
    let failOnce = true;
    const upstream = portal({ failRead(state) {
        if (state.selected === '41' && failOnce) { failOnce = false; state.token++; return true; }
        return false;
    } });
    await expect(upstream.service.getGradeHistory('gibsso', 'alpha', 'pw', { semesterIds: ['41'] })).rejects.toThrow('Grade history is unavailable.');
    expect(upstream.states.get('alpha').selected).toBe('42');
});

test('existing current-grade service sees the original semester after authenticated transport history', async () => {
    const axios = require('axios').default;
    const api = require('./kaschuso-api');
    let selected = '42';
    const homeHtml = '<a href="index.php?pageid=21311&amp;id=synthetic&amp;transid=synthetic1">Grades</a>';
    const response = data => ({ status: 200, data, cookies: {}, headers: {} });
    const get = jest.spyOn(axios, 'get').mockImplementation(async url => {
        if (url === 'https://kaschuso.so.ch/') return { ...response(''), cookies: { PHPSESSID: 'synthetic' } };
        if (url.includes('sil-bid-check/ses.js')) return response("var bid=getBid('synthetic');");
        if (url.includes('login/sls/auth')) return response('<form name="LoginForm"></form>');
        if (url.includes('/loginto.php')) return response(homeHtml);
        if (url.includes('/gibsso/index.php')) return response(page(selected, 'synthetic1', OPTIONS, gradeTable('Deutsch', selected === '42' ? '5.0' : '4.5')));
        throw new Error('Unexpected synthetic GET');
    });
    const post = jest.spyOn(axios, 'post').mockImplementation(async () => ({ ...response(''), cookies: { SCDID_S: 'synthetic-auth' } }));
    const request = jest.spyOn(axios, 'request').mockImplementation(async config => {
        if (new URL(config.url).origin !== 'https://kaschuso.so.ch' || config.maxRedirects !== 0 || config.timeout > 20000 || !config.headers.Cookie.includes('SCDID_S=synthetic-auth')) throw new Error('Unsafe history transport');
        if (config.method === 'post') {
            selected = new URLSearchParams(config.data).getAll('xajaxargs[]')[0];
            return response('<xjx></xjx>');
        }
        return response(page(selected, 'synthetic1', OPTIONS, gradeTable('Deutsch', selected === '42' ? '5.0' : '4.5')));
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
        const result = await api.getGradeHistory('gibsso', 'synthetic-transport-account', 'synthetic-password', { semesterIds: ['41'] });
        expect(result.semesters[0].subjects[0].average).toBe('4.5');
        const current = await api.getGrades('gibsso', 'synthetic-transport-account', 'synthetic-password');
        expect(current[0].average).toBe('5.0');
        expect(selected).toBe('42');
        await api.clearAccount('gibsso', 'synthetic-transport-account');
    } finally { get.mockRestore(); post.mockRestore(); request.mockRestore(); log.mockRestore(); }
});

describe('grade history REST privacy boundary', () => {
    let server;
    let endpoint;
    let history;
    const { createAuthSession } = require('../routes/api/middleware/auth');
    const token = createAuthSession('gibsso', 'synthetic-rest-account', 'synthetic-password').token;
    beforeAll(async () => {
        history = jest.spyOn(require('./kaschuso-api'), 'getGradeHistory');
        const express = require('express');
        const app = express();
        app.use('/api/grade-history', require('../routes/api/grade-history'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        endpoint = `http://127.0.0.1:${server.address().port}/api/grade-history`;
    });
    afterAll(async () => { history?.mockRestore(); if (server) await new Promise(resolve => server.close(resolve)); });
    const request = (query = '', authenticated = true) => fetch(endpoint + query, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });

    test('requires normal bearer authentication and disables response caching', async () => {
        const response = await request('', false);
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
    });

    test.each(['?username=other', '?password=other', '?mandator=other', '?semesters=42,42', '?semesters=', '?semesters=42&semesters=41', '?semesters=42,../41'])('rejects credential or malformed query input: %s', async query => {
        const response = await request(query);
        expect(response.status).toBe(400);
    });

    test('uses only authenticated credentials and returns the history contract without account fields', async () => {
        history.mockImplementationOnce(async (mandator, username, password, options) => {
            if (mandator !== 'gibsso' || username !== 'synthetic-rest-account' || password !== 'synthetic-password' || options.semesterIds.join(',') !== '41,42') throw new Error('Incorrect authorization binding');
            return { availableSemesters: [], selectedSemester: { id: '42', label: '1.26/27' }, semesters: [], complete: true, issues: [] };
        });
        const response = await request('?semesters=41,42');
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.complete).toBe(true);
        expect(Object.keys(result)).toEqual(['availableSemesters', 'selectedSemester', 'semesters', 'complete', 'issues']);
        expect(JSON.stringify(result)).not.toMatch(/synthetic-rest-account|synthetic-password/);
    });

    test('sanitizes upstream errors without exposing navigation or school markup', async () => {
        history.mockRejectedValueOnce(new Error('Synthetic private markup https://private.invalid/?id=synthetic'));
        const response = await request();
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'GRADE_HISTORY_UNAVAILABLE', detail: 'Grade history is unavailable.' });
    });

    test('a rejected school login requests a fresh sign-in without exposing diagnostics', async () => {
        const error = new Error('SYNTHETIC_PRIVATE_LOGIN'); error.name = 'AuthenticationError';
        history.mockRejectedValueOnce(error);
        const response = await request();
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'SCHOOL_SIGN_IN_REQUIRED', detail: 'Sign in to your school account again.' });
    });
});
