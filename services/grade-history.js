const cheerio = require('cheerio');
const { createHash } = require('crypto');

const ORIGIN = 'https://kaschuso.so.ch';
const CACHE_TTL_MS = 60000;
const MAX_CACHE_ENTRIES = 100;

function unavailable() {
    const error = new Error('Grade history is unavailable.');
    error.code = 'GRADE_HISTORY_UNAVAILABLE';
    error.status = 502;
    return error;
}

function safeFailure(error) {
    if (error?.name !== 'AuthenticationError') return unavailable();
    const safe = new Error('School sign-in needs updating.');
    safe.name = 'AuthenticationError';
    safe.status = 401;
    safe.authDiagnostics = {
        hasCredentialError: error.authDiagnostics?.hasCredentialError === true,
        hasLocationHeader: error.authDiagnostics?.hasLocationHeader === true
    };
    return safe;
}

function invalidSemesters() {
    const error = new Error('Select between one and eight available semesters.');
    error.code = 'INVALID_SEMESTERS';
    error.status = 400;
    return error;
}

function validateSemesterIds(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 ||
        ids.some(id => typeof id !== 'string' || !/^\d{1,12}$/.test(id)) || new Set(ids).size !== ids.length) {
        throw invalidSemesters();
    }
    return ids;
}

function trustedUrl(value, mandator, file = 'index.php') {
    if (!/^[a-z0-9-]{1,50}$/.test(mandator) || typeof value !== 'string' || value.length > 2048) throw unavailable();
    let url;
    try { url = new URL(value, `${ORIGIN}/${mandator}/`); } catch { throw unavailable(); }
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== `/${mandator}/${file}` ||
        url.searchParams.get('pageid') !== '21311') throw unavailable();
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => !['pageid', 'id', 'transid', 'listindex_s'].includes(key)) || new Set(keys).size !== keys.length) throw unavailable();
    return url.href;
}

function semesterDates(label) {
    const match = /^([12])\.\s*(\d{2}|\d{4})\/(\d{2}|\d{4})$/.exec(label);
    if (!match) throw unavailable();
    const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
    const nextYear = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    if (year < 2000 || nextYear !== year + 1) throw unavailable();
    return match[1] === '1'
        ? { start: Date.UTC(year, 7, 1), end: Date.UTC(nextYear, 1, 1) }
        : { start: Date.UTC(nextYear, 1, 1), end: Date.UTC(nextYear, 7, 1) };
}

function parseSemesterPage(html, mandator, now = Date.now()) {
    if (typeof html !== 'string' || html.length > 5 * 1024 * 1024) throw unavailable();
    const $ = cheerio.load(html);
    const selector = $('select#sem');
    if (selector.length !== 1 || !$('#uebersicht_bloecke').length) throw unavailable();
    const options = selector.find('option').toArray();
    if (!options.length || options.length > 500) throw unavailable();
    const allSemesters = options.map(option => {
        const id = $(option).attr('value');
        const label = $(option).text().trim();
        if (!/^\d{1,12}$/.test(id || '')) throw unavailable();
        const { start, end } = semesterDates(label);
        return { id, label, isCurrent: start <= now && now < end, start };
    });
    if (new Set(allSemesters.map(semester => semester.id)).size !== allSemesters.length) throw unavailable();
    const selected = selector.find('option[selected]');
    if (selected.length !== 1) throw unavailable();
    const original = allSemesters.find(semester => semester.id === selected.attr('value'));
    const action = /^\s*xajax_save_semid\(\s*this\.value\s*,\s*(['"])([^'"\\\r\n]+)\1\s*\)\s*;?\s*$/.exec(selector.attr('onchange') || '');
    if (!action) throw unavailable();
    const returnLink = action[2];
    const returnUrl = trustedUrl(returnLink, mandator);
    const requests = $('script').toArray().flatMap(script =>
        [...($(script).html() || '').matchAll(/\bxajaxRequestUri\s*=\s*(['"])([^'"\\\r\n]+)\1\s*(?=;|$)/g)]);
    if (requests.length !== 1) throw unavailable();
    const actionUrl = trustedUrl(requests[0][2], mandator, 'xajax_js.php');
    return {
        availableSemesters: allSemesters.filter(semester => semester.start <= now)
            .sort((a, b) => b.start - a.start).map(({ start, ...semester }) => semester),
        selectedSemester: { id: original.id, label: original.label },
        allSemesters,
        returnLink,
        returnUrl,
        actionUrl
    };
}

function gradesUrlFromHome(html, mandator) {
    const $ = cheerio.load(String(html || ''));
    for (const anchor of $('a[href]').toArray()) {
        const href = $(anchor).attr('href');
        try {
            const url = new URL(href, `${ORIGIN}/${mandator}/`);
            if (url.searchParams.get('pageid') === '21311') return trustedUrl(href, mandator);
        } catch { /* Unsupported links are never followed. */ }
    }
    throw unavailable();
}

function safeSubjects(subjects) {
    if (!Array.isArray(subjects)) throw unavailable();
    return subjects.map(subject => ({
        name: subject.name,
        average: subject.average,
        grades: (subject.grades || []).map(grade => Object.fromEntries(
            ['date', 'name', 'value', 'weighting', 'points', 'average']
                .filter(key => grade[key] !== undefined).map(key => [key, grade[key]])
        ))
    }));
}

function createGradeHistoryService({ openSession, parseGrades, runAccount, normalizeMandator = value => String(value).toLowerCase(), now = Date.now }) {
    const cache = new Map();
    // Failed restoration must also guard subsequent current-grade reads. These
    // obligations contain only a portal semester ID and stay until repaired or
    // the account is disconnected; dropping one could expose relabelled marks.
    const restoreObligations = new Map();
    const accountKey = (mandator, username) => JSON.stringify([mandator, username]);
    const copy = value => JSON.parse(JSON.stringify(value));

    function clearAccount(mandator, username) {
        const key = accountKey(normalizeMandator(mandator), username);
        for (const [cacheKey, entry] of cache) if (entry.account === key) cache.delete(cacheKey);
        restoreObligations.delete(key);
    }

    async function open(mandator, username, password) {
        const session = await openSession(mandator, username, password);
        const url = gradesUrlFromHome(session.homeHtml, mandator);
        const context = { session, page: undefined, url };
        await read(context, mandator);
        return context;
    }

    async function read(context, mandator) {
        const html = await context.session.request({ method: 'GET', url: context.page?.returnUrl || context.url });
        context.page = parseSemesterPage(html, mandator, now());
        context.html = html;
    }

    async function select(context, mandator, id) {
        if (!context.page.allSemesters.some(semester => semester.id === id)) throw unavailable();
        const body = new URLSearchParams();
        body.set('xajax', 'save_semid');
        body.set('xajaxr', String(now()));
        body.append('xajaxargs[]', id);
        body.append('xajaxargs[]', context.page.returnLink);
        await context.session.request({ method: 'POST', url: context.page.actionUrl, body: body.toString() });
        await read(context, mandator);
        if (context.page.selectedSemester.id !== id) throw unavailable();
    }

    async function restore(context, mandator, id) {
        // The failed request may already have changed session state. Refresh the
        // selector and navigation token before deciding whether to switch back.
        await read(context, mandator);
        if (context.page.selectedSemester.id !== id) await select(context, mandator, id);
        if (context.page.selectedSemester.id !== id) throw unavailable();
    }

    // Called inside the same account queue as getGrades, never recursively queued.
    async function ensureRestored(mandator, username, password) {
        mandator = normalizeMandator(mandator);
        const key = accountKey(mandator, username);
        if (!restoreObligations.has(key)) return;
        try {
            const context = await open(mandator, username, password);
            await restore(context, mandator, restoreObligations.get(key));
            restoreObligations.delete(key);
        } catch (error) { throw safeFailure(error); }
    }

    async function retrieve(mandator, username, password, ids) {
        const key = accountKey(mandator, username);
        await ensureRestored(mandator, username, password);
        const context = await open(mandator, username, password);
        const available = context.page.availableSemesters;
        const requested = ids || available.slice(0, 8).map(semester => semester.id);
        if (!requested.length || requested.some(id => !available.some(semester => semester.id === id))) throw invalidSemesters();
        const selectedSemester = context.page.selectedSemester;
        const semesters = [];
        let switched = false;
        try {
            for (const id of requested) {
                if (context.page.selectedSemester.id !== id) {
                    switched = true;
                    await select(context, mandator, id);
                }
                if (context.page.selectedSemester.id !== id) throw unavailable();
                const semester = available.find(item => item.id === id);
                semesters.push({ ...semester, subjects: safeSubjects(await parseGrades(context.html)) });
            }
        } finally {
            if (switched) {
                try {
                    try { await restore(context, mandator, selectedSemester.id); }
                    catch {
                        // A timed-out GET may have consumed its navigation token.
                        // Re-enter through the fixed authenticated homepage once.
                        const fresh = await open(mandator, username, password);
                        await restore(fresh, mandator, selectedSemester.id);
                    }
                }
                catch (error) {
                    restoreObligations.set(key, selectedSemester.id);
                    for (const [cacheKey, entry] of cache) if (entry.account === key) cache.delete(cacheKey);
                    throw safeFailure(error);
                }
            }
        }
        return { availableSemesters: available, selectedSemester, semesters, complete: true, issues: [], retrievedAt: new Date(now()).toISOString() };
    }

    async function getGradeHistory(mandator, username, password, options = {}) {
        mandator = normalizeMandator(mandator);
        if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'semesterIds')) throw invalidSemesters();
        const ids = options.semesterIds === undefined ? undefined : [...validateSemesterIds(options.semesterIds)];
        return runAccount(mandator, username, async () => {
            const account = accountKey(mandator, username);
            const credential = createHash('sha256').update(String(password)).digest('hex');
            const key = JSON.stringify([account, credential, ids || null]);
            for (const [cacheKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(cacheKey);
            const cached = cache.get(key);
            if (cached && !restoreObligations.has(account)) return copy(cached.result);
            let result;
            try { result = await retrieve(mandator, username, password, ids); }
            catch (error) {
                if (error.code === 'INVALID_SEMESTERS') throw error;
                throw safeFailure(error);
            }
            if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) cache.delete(cache.keys().next().value);
            cache.set(key, { account, result, expiresAt: now() + CACHE_TTL_MS });
            return copy(result);
        });
    }

    return { getGradeHistory, ensureRestored, clearAccount };
}

module.exports = { createGradeHistoryService, parseSemesterPage, validateSemesterIds, trustedUrl };
