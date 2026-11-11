const express = require('express');
const { createAuthSession } = require('./middleware/auth');

describe('qualification REST account boundary', () => {
  let server, base, calls, router;
  beforeAll(async () => {
    calls = [];
    const school = { async getGradeHistory(mandator, username) { calls.push([mandator, username]); return { semesters: [], complete: true, issues: [] }; } };
    const engine = {
      validateScenario(value) { if (!value || typeof value !== 'object' || Object.keys(value).some(k => k !== 'ipaGrade')) throw new TypeError('Invalid scenario'); return value; },
      buildQualification(history, scenario = {}) { return { profile: { id: 'synthetic' }, issues: history.issues, scenario }; },
      getRules() { return { profile: { id: 'synthetic' }, sources: [] }; },
    };
    router = require('./qualification').createQualificationRouter({ school, engine });
    const app = express(); app.use(express.json({ limit: '8kb' })); app.use('/api/qualification', router);
    app.use('/api/qualification-real', require('./qualification').createQualificationRouter({ school }));
    app.use((_error, _req, res, _next) => res.status(503).json({ error: 'UNAVAILABLE' }));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/qualification`;
  });
  afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
  test('requires dashboard authorization before requesting history', async () => {
    const count = calls.length;
    expect((await fetch(base)).status).toBe(401);
    expect(calls.length).toBe(count);
  });
  test('uses only the authenticated account and marks output private', async () => {
    const token = createAuthSession('school-a', 'SYNTHETIC_STUDENT', 'SYNTHETIC_PASSWORD').token;
    const response = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(calls.at(-1)).toEqual(['school-a', 'SYNTHETIC_STUDENT']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toContain('SYNTHETIC_STUDENT');
  });
  test('rejects credentials and forged scenario keys before upstream work', async () => {
    const token = createAuthSession('school-a', 'SYNTHETIC_STUDENT', 'SYNTHETIC_PASSWORD').token;
    const count = calls.length;
    const response = await fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SYNTHETIC_OTHER' }) });
    expect(response.status).toBe(400); expect(calls.length).toBe(count);
    expect((await fetch(`${base}?password=SYNTHETIC_PASSWORD`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(400);
  });
  test('public rules require no school request', async () => {
    const count = calls.length;
    const response = await fetch(`${base}/rules`);
    expect(response.status).toBe(200); expect(calls.length).toBe(count);
  });
  test('history-dependent scenario validation returns 400 rather than a service failure', async () => {
    const token = createAuthSession('school-a', 'SYNTHETIC_STUDENT', 'SYNTHETIC_PASSWORD').token;
    const response = await fetch(base.replace('/qualification', '/qualification-real'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ semesterOverrides: { unknownSemester: { deutsch: 5 } } }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_SCENARIO' });
  });
});
