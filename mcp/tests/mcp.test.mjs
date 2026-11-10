import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, connect } from './helpers.mjs';
import { mountMcp } from '../server.mjs';

let h;
let handler;
const calls = [];
let rejectedSchoolLogin = false;
before(async () => {
  h = await harness();
  handler = mountMcp(h.app, { config: h.config, oauth: h.oauth, store: h.store, school: {
    async getGrades(mandator, username) { if (rejectedSchoolLogin) throw new Error('Synthetic rejected school login'); calls.push({ mandator, username }); return [{ name: username.endsWith('_A') ? 'Mathematics' : 'Biology', class: 'SYNTHETIC_COURSE', average: '5', grades: [{ date: '01.01.2000', name: 'Synthetic assessment', value: '5', weighting: '1' }] }]; },
    getAuthenticationFailureInfo() { return { reason: 'INVALID_CREDENTIALS' }; },
    async getUnconfirmedGrades() { return []; },
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
test('MCP discovers four read-only tools and isolates concurrent student calls', async () => {
  const a = await connect(h);
  const b = await connect(h, h.dashboard('school-a', 'SYNTHETIC_STUDENT_B'));
  const list = await rpc(a.tokens.access_token, 'tools/list');
  assert.equal(list.response.status, 200);
  assert.equal(list.body.result.tools.length, 4);
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
