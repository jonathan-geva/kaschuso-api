import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, connect } from './helpers.mjs';
import { mountMcp } from '../server.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const schoolService = require('../../services/kaschuso-api');
const { createGradeHistoryService } = require('../../services/grade-history');
function rejectedCredentials() { const e = new Error('SYNTHETIC_PRIVATE_DIAGNOSTICS'); e.name = 'AuthenticationError'; e.authDiagnostics = { hasCredentialError: true }; return e; }
const rejectedHistory = createGradeHistoryService({ openSession: async () => { throw rejectedCredentials(); }, parseGrades: () => [], runAccount: require('../../services/account-queue').runAccount });

let h;
let handler;
const calls = [];
let rejectedSchoolLogin = false;
let rejectedHistoryLogin = false;
let historyGate;
before(async () => {
  h = await harness();
  handler = mountMcp(h.app, { config: h.config, oauth: h.oauth, store: h.store, school: {
    async getGrades(mandator, username) { if (rejectedSchoolLogin) throw rejectedCredentials(); calls.push({ mandator, username }); return [{ name: username.endsWith('_A') ? 'Mathematics' : 'Biology', class: 'SYNTHETIC_COURSE', average: '5', grades: [{ date: '01.01.2000', name: 'Synthetic assessment', value: '5', weighting: '1' }] }]; },
    getAuthenticationFailureInfo: schoolService.getAuthenticationFailureInfo,
    async getUnconfirmedGrades() { return []; },
    async getGradeHistory(mandator, username) { if (rejectedHistoryLogin) return rejectedHistory.getGradeHistory(mandator, username, "SYNTHETIC_PASSWORD"); calls.push({ mandator, username }); if (historyGate) { historyGate.started(); await historyGate.wait; } return { availableSemesters: [{ id: '38', label: '1. 24/25', isCurrent: true }], selectedSemester: { id: '38', label: '1. 24/25' }, semesters: [{ id: '38', label: '1. 24/25', isCurrent: true, subjects: [{ name: username.endsWith('_A') ? 'Deutsch' : 'Französisch', average: '5', grades: [] }] }], complete: true, issues: [], retrievedAt: '2000-01-01T00:00:00Z' }; },
  } });
});
after(async () => { await handler?.close(); if (h) await h.close(); });
async function rpc(token, method, params = {}) {
  const response = await fetch(`${h.base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = JSON.parse(text.split('\n').find(x => x.startsWith('data: '))?.slice(6) || '{}'); }
  return { response, body };
}

test('MCP challenges unauthorized clients without accessing school data', async () => {
  const result = await rpc('', 'tools/list');
  assert.equal(result.response.status, 401);
  assert.match(result.response.headers.get('WWW-Authenticate'), /resource_metadata/);
  assert.equal(calls.length, 0);
  assert.equal((await rpc(h.dashboard(), 'tools/list')).response.status, 401);
});
test('MCP discovers seven read-only tools and isolates concurrent student calls', async () => {
  const a = await connect(h);
  const b = await connect(h, h.dashboard('school-a', 'SYNTHETIC_STUDENT_B'));
  const list = await rpc(a.tokens.access_token, 'tools/list');
  assert.equal(list.response.status, 200);
  assert.equal(list.body.result.tools.length, 7);
  assert.ok(list.body.result.tools.every(tool => tool.annotations.readOnlyHint));
  const [first, second] = await Promise.all([rpc(a.tokens.access_token, 'tools/call', { name: 'get_grade_overview', arguments: {} }), rpc(b.tokens.access_token, 'tools/call', { name: 'get_grade_overview', arguments: {} })]);
  assert.equal(first.body.result.structuredContent.subjects[0].name, 'Mathematics');
  assert.equal(second.body.result.structuredContent.subjects[0].name, 'Biology');
  assert.equal(JSON.stringify(first.body).includes('SYNTHETIC_STUDENT'), false);
  const forged = await rpc(a.tokens.access_token, 'tools/call', { name: 'get_grade_overview', arguments: { username: 'SYNTHETIC_STUDENT_B' } });
  assert.ok(forged.body.result?.isError || forged.body.error);
  const identity = await h.oauth.authenticateMcp(a.tokens.access_token);
  await h.store.revokeConnection(identity.grantId);
  assert.equal((await rpc(a.tokens.access_token, 'tools/list')).response.status, 401);
});

test('history and qualification tools use the OAuth account and reject forged identity', async () => {
  const a = await connect(h);
  const b = await connect(h, h.dashboard('school-a', 'SYNTHETIC_STUDENT_B'));
  const first = await rpc(a.tokens.access_token, 'tools/call', { name: 'get_grade_history', arguments: {} });
  const second = await rpc(b.tokens.access_token, 'tools/call', { name: 'get_grade_history', arguments: {} });
  assert.equal(first.body.result.structuredContent.semesters[0].subjects[0].name, 'Deutsch');
  assert.equal(first.body.result.structuredContent.retrievedAt, '2000-01-01T00:00:00Z');
  assert.equal(second.body.result.structuredContent.semesters[0].subjects[0].name, 'Französisch');
  assert.equal(JSON.stringify(first.body).includes('SYNTHETIC_STUDENT'), false);
  const overview = await rpc(a.tokens.access_token, 'tools/call', { name: 'get_qualification_overview', arguments: {} });
  assert.equal(overview.body.result.structuredContent.profile.id, 'gibs-so-informatik-bm-2021');
  const forged = await rpc(a.tokens.access_token, 'tools/call', { name: 'calculate_qualification_scenario', arguments: { username: 'SYNTHETIC_STUDENT_B' } });
  assert.ok(forged.body.result?.isError || forged.body.error);
});

test('initialization carries portable grade interpretation instructions', async () => {
  const { tokens } = await connect(h);
  const result = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-client', version: '1.0.0' } });
  assert.match(result.body.result.instructions, /BM/);
  assert.match(result.body.result.instructions, /IDAF/);
});

test('MCP accepts the documented Claude web origin but blocks unrelated origins', async () => {
  const { tokens } = await connect(h);
  const send = origin => fetch(`${h.base}/mcp`, { method: 'OPTIONS', headers: { Origin: origin, Authorization: `Bearer ${tokens.access_token}` } });
  assert.equal((await send('https://claude.ai')).status, 204);
  assert.equal((await send('https://untrusted.example')).status, 403);
});

test('database failure does not fall back to cached authorization', async () => {
  const { tokens } = await connect(h);
  const original = h.pool.query;
  const count = calls.length;
  try {
    h.pool.query = async () => { throw new Error('Synthetic database outage'); };
    assert.equal((await rpc(tokens.access_token, 'tools/list')).response.status, 503);
    assert.equal(calls.length, count);
  } finally { h.pool.query = original; }
});

test('invalid qualification subjects fail without school access or reconnecting a valid account', async () => {
  const { tokens } = await connect(h);
  const count = calls.length;
  const result = await rpc(tokens.access_token, 'tools/call', { name: 'calculate_qualification_scenario', arguments: { targets: { unknownSubject: 5 } } });
  assert.equal(result.body.result.structuredContent.error, 'INVALID_SCENARIO');
  assert.equal(calls.length, count);
  assert.equal((await h.oauth.authenticateMcp(tokens.access_token)).reconnect, false);
});

test('revocation while historical school work is in flight suppresses the returned data', async () => {
  const { tokens } = await connect(h);
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  historyGate = { started, wait: new Promise(resolve => { release = resolve; }) };
  try {
    const pending = rpc(tokens.access_token, 'tools/call', { name: 'get_grade_history', arguments: {} });
    await entered;
    const identity = await h.oauth.authenticateMcp(tokens.access_token);
    await h.store.revokeConnection(identity.grantId);
    release();
    const result = await pending;
    assert.equal(result.body.result.structuredContent.error, 'RECONNECT_REQUIRED');
    assert.equal(JSON.stringify(result.body).includes('Deutsch'), false);
  } finally { release(); historyGate = undefined; }
});

test('reconnect bookkeeping failures never expose database diagnostics through tool errors', async () => {
  const { tokens } = await connect(h);
  const original = h.store.markReconnect;
  try {
    rejectedSchoolLogin = true;
    h.store.markReconnect = async () => { throw new Error('SYNTHETIC_PRIVATE_DATABASE_ID'); };
    const result = await rpc(tokens.access_token, 'tools/call', { name: 'get_grade_overview', arguments: {} });
    assert.equal(JSON.stringify(result.body).includes('SYNTHETIC_PRIVATE_DATABASE_ID'), false);
    assert.equal(result.body.result.isError, true);
  } finally { rejectedSchoolLogin = false; h.store.markReconnect = original; }
});

test('all historical qualification tools request reconnection after a classified school login rejection', async () => {
  try {
    rejectedHistoryLogin = true;
    for (const name of ['get_grade_history', 'get_qualification_overview', 'calculate_qualification_scenario']) {
      const { tokens } = await connect(h);
      const result = await rpc(tokens.access_token, 'tools/call', { name, arguments: {} });
      assert.equal(result.body.result.structuredContent.error, 'RECONNECT_REQUIRED');
      assert.equal((await h.oauth.authenticateMcp(tokens.access_token)).reconnect, true);
      assert.equal(JSON.stringify(result.body).includes('SYNTHETIC_PRIVATE_DIAGNOSTICS'), false);
    }
  } finally { rejectedHistoryLogin = false; }
});
