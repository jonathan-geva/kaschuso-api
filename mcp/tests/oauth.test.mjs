import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, browser, register, begin, approve, finish, exchange, connect } from './helpers.mjs';

let h;
before(async () => { h = await harness(); });
after(async () => { if (h) await h.close(); });

test('OAuth discovery advertises S256 and grade resource metadata', async () => {
  const discovery = await (await fetch(`${h.base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(discovery.issuer, h.config.issuer);
  assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
  const resource = await (await fetch(`${h.base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(resource.resource, h.config.resource);
  assert.deepEqual(resource.scopes_supported, ['grades:read']);
});

test('school consent and PKCE produce an account-bound access token and rotating refresh token', async () => {
  const result = await connect(h);
  assert.equal(result.response.status, 200);
  assert.ok(result.tokens.refresh_token);
  assert.equal(result.tokens.expires_in, 600);
  const identity = await h.oauth.authenticateMcp(result.tokens.access_token);
  assert.equal((await h.pool.query('SELECT authorization_completed FROM mcp_connections WHERE grant_id=$1', [identity.grantId])).rows[0].authorization_completed, true);
  assert.equal(identity.credentials.username, 'SYNTHETIC_STUDENT_A');
  assert.equal(result.callback.searchParams.get('state'), 'synthetic-state');
  assert.equal(result.callback.searchParams.get('iss'), h.config.issuer);
  await assert.rejects(h.oauth.authenticateMcp(h.dashboard()));
});

test('copied authorization link cannot attach victim grades to attacker browser', async () => {
  const { client } = await register(h);
  const flow = await begin(h, client);
  const { body } = await approve(h, flow, h.dashboard('school-a', 'SYNTHETIC_STUDENT_B'));
  const attacker = await flow.userBrowser(`/oauth/connect/${flow.uid}/complete`);
  assert.equal(attacker.status, 400, 'original browser alone has no consent proof');
  const victim = await finish(h, flow, body.proof, browser(h.base));
  assert.equal(victim.status, 400, 'consenting different browser has no original interaction cookie');
  assert.equal((await h.store.listConnections({ mandator: 'school-a', username: 'SYNTHETIC_STUDENT_B' })).length, 0);
});

test('cancelled consent creates no retained account and returns access_denied', async () => {
  const { client } = await register(h);
  const flow = await begin(h, client);
  const { body } = await approve(h, flow, '', true);
  const response = await finish(h, flow, body.proof);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('error'), 'access_denied');
});

test('PKCE and resource constraints reject invalid requests and code replay', async () => {
  const { client } = await register(h);
  const invalid = await begin(h, client, browser(h.base), { resource: 'https://other.example/mcp' });
  assert.ok(invalid.location?.includes('invalid_target'));
  const plain = await begin(h, client, browser(h.base), { code_challenge_method: 'plain' });
  assert.ok(plain.location?.includes('invalid_request'));
  const flow = await begin(h, client);
  const { body } = await approve(h, flow);
  const final = await finish(h, flow, body.proof);
  const code = new URL(final.headers.get('location')).searchParams.get('code');
  const results = await Promise.all([exchange(h, client, flow, code), exchange(h, client, flow, code)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 400]);
  const good = await results.find(x => x.status === 200).json();
  await assert.rejects(h.oauth.authenticateMcp(good.access_token), 'replay revoked the grant');
});

test('refresh rotation rejects reuse and revokes the whole connection', async () => {
  const { client, tokens } = await connect(h);
  const refresh = () => fetch(`${h.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: h.config.resource }) });
  const first = await refresh();
  assert.equal(first.status, 200);
  const next = await first.json();
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.equal((await refresh()).status, 400);
  await assert.rejects(h.oauth.authenticateMcp(next.access_token));
});

test('connection revocation is owned and invalidates access immediately', async () => {
  const { tokens } = await connect(h);
  const identity = await h.oauth.authenticateMcp(tokens.access_token);
  assert.equal(await h.store.revokeOwned(identity.grantId, { mandator: 'school-b', username: 'SYNTHETIC_STUDENT_A' }), false);
  assert.ok(await h.oauth.authenticateMcp(tokens.access_token));
  assert.equal(await h.store.revokeOwned(identity.grantId, { mandator: 'school-a', username: 'SYNTHETIC_STUDENT_A' }), true);
  await assert.rejects(h.oauth.authenticateMcp(tokens.access_token));
});

test('registration rejects unsafe redirect and remote-key metadata', async () => {
  assert.equal((await register(h, { redirect_uris: ['http://insecure.example/callback'] })).response.status, 400);
  assert.equal((await register(h, { jwks_uri: 'http://127.0.0.1/private' })).response.status, 400);
});

test('concurrent refresh reuse fails closed for both resulting token families', async () => {
  const { client, tokens } = await connect(h);
  const refresh = () => fetch(`${h.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: h.config.resource }) });
  const replies = await Promise.all([refresh(), refresh()]);
  assert.deepEqual(replies.map(x => x.status).sort(), [200, 400]);
  const issued = await replies.find(x => x.status === 200).json();
  await assert.rejects(h.oauth.authenticateMcp(issued.access_token));
});

test('wrong PKCE verifier and unregistered redirect do not yield tokens', async () => {
  const { client } = await register(h);
  const badRedirect = await begin(h, client, browser(h.base), { redirect_uri: 'https://other.example/callback' });
  assert.equal(badRedirect.response.status, 400);
  const flow = await begin(h, client);
  const { body } = await approve(h, flow);
  const final = await finish(h, flow, body.proof);
  const code = new URL(final.headers.get('location')).searchParams.get('code');
  assert.equal((await exchange(h, client, { ...flow, verifier: 'x'.repeat(43) }, code)).status, 400);
});

test('expired interaction and mismatched proxy host cannot continue consent', async () => {
  const { client } = await register(h);
  const flow = await begin(h, client);
  await h.pool.query("UPDATE mcp_oauth_models SET expires_at=now()-interval '1 second' WHERE model='Interaction'");
  assert.equal((await approve(h, flow)).response.status, 410);
  const forged = await fetch(`${h.base}/.well-known/oauth-authorization-server`, { headers: { 'X-Forwarded-Host': 'other.example' } });
  assert.equal(forged.status, 400);
});

test('missing, unsupported and mixed identity scopes are rejected before consent or persistence', async () => {
  const { client } = await register(h);
  const before = await h.pool.query('SELECT count(*) FROM mcp_accounts');
  for (const scope of ['', 'unsupported', 'openid grades:read']) {
    const flow = await begin(h, client, browser(h.base), { scope });
    assert.equal(flow.uid, undefined, 'Invalid scopes must not reach the school consent page');
    assert.ok(new URL(flow.location || flow.response.headers.get('location')).searchParams.get('error'));
  }
  const unsupportedMode = await begin(h, client, browser(h.base), { response_mode: 'form_post' });
  assert.equal(unsupportedMode.uid, undefined);
  assert.equal((await h.pool.query('SELECT count(*) FROM mcp_accounts')).rows[0].count, before.rows[0].count);
});

test('failed interaction completion removes the newly retained account and connection', async () => {
  const { client } = await register(h);
  const flow = await begin(h, client);
  const credentials = { mandator: 'school-a', username: 'SYNTHETIC_FAILED_CONNECTION' };
  const { body } = await approve(h, flow, h.dashboard(credentials.mandator, credentials.username));
  const original = h.oauth.provider.interactionFinished;
  try {
    h.oauth.provider.interactionFinished = async () => { throw new Error('Synthetic completion failure'); };
    assert.equal((await finish(h, flow, body.proof)).status, 503);
  } finally { h.oauth.provider.interactionFinished = original; }
  assert.equal((await h.store.listConnections(credentials)).length, 0);
  assert.equal((await h.pool.query('SELECT 1 FROM mcp_accounts WHERE locator=$1', [h.store.locator(credentials)])).rowCount, 0);
});
