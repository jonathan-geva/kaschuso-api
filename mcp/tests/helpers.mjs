import { randomBytes, randomUUID, generateKeyPairSync, createHash } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Store } from '../store.mjs';
import { createVault } from '../crypto.mjs';
import { createOAuth } from '../oauth.mjs';

const require = createRequire(import.meta.url);
const { createAuthSession, requireAuth } = require('../../routes/api/middleware/auth.js');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'synthetic-signing-key', use: 'sig', alg: 'RS256' };

export async function harness() {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/kaschuso_test', options: `-c search_path=${schema}` });
  await pool.query(`CREATE SCHEMA ${schema}`);
  const vault = createVault(randomBytes(32).toString('base64'), randomBytes(32).toString('base64'));
  const store = new Store(pool, vault);
  await store.migrate();
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { publicUrl: base, issuer: `${base}/oauth`, resource: `${base}/mcp`, frontendUrl: 'http://127.0.0.1:5173', cookieKey: randomBytes(32).toString('base64'), secure: false, jwks: { keys: [jwk] } };
  const oauth = await createOAuth({ config, store, requireDashboard: requireAuth });
  app.use(oauth.router);
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(503).json({ error: 'SERVICE_UNAVAILABLE' }); });
  return {
    app, base, config, store, pool, oauth,
    dashboard(mandator = 'school-a', username = 'SYNTHETIC_STUDENT_A') { return createAuthSession(mandator, username, 'SYNTHETIC_PASSWORD').token; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); },
  };
}

export function browser(base) {
  const cookies = new Map();
  return async (path, options = {}) => {
    const headers = new Headers(options.headers);
    if (cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetch(new URL(path, base), { ...options, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (!value) cookies.delete(name); else cookies.set(name, value);
    }
    return response;
  };
}

export async function register(h, overrides = {}) {
  const response = await fetch(`${h.base}/oauth/reg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Synthetic grade client', redirect_uris: ['https://client.example/callback'], response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none', ...overrides }) });
  return { response, client: await response.json() };
}

export async function begin(h, client, userBrowser = browser(h.base), overrides = {}) {
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://client.example/callback', response_type: 'code', scope: 'grades:read', resource: h.config.resource, state: 'synthetic-state', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...overrides });
  const response = await userBrowser(`/oauth/auth?${params}`);
  if (![302, 303].includes(response.status)) return { response, verifier, userBrowser };
  const location = response.headers.get('location');
  if (!location.includes('/oauth/connect/')) return { response, location, verifier, userBrowser };
  const page = await userBrowser(location);
  const uid = new URLSearchParams(new URL(page.headers.get('location')).hash.slice(1)).get('request');
  return { response, page, uid, verifier, userBrowser };
}

export async function approve(h, flow, token = h.dashboard(), denied = false) {
  const response = await fetch(`${h.base}/api/mcp/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: h.config.frontendUrl }, body: JSON.stringify({ interaction: flow.uid, denied }) });
  return { response, body: await response.json() };
}

export async function finish(h, flow, proof, userBrowser = flow.userBrowser) {
  const resume = await userBrowser(`/oauth/connect/${flow.uid}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: h.config.frontendUrl }, body: new URLSearchParams({ proof }) });
  if (resume.status !== 303) return resume;
  const complete = await userBrowser(resume.headers.get('location'));
  if (complete.status !== 303 || !complete.headers.get('location')?.includes('/oauth/auth/')) return complete;
  return userBrowser(complete.headers.get('location'));
}

export async function exchange(h, client, flow, code) {
  return fetch(`${h.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: 'https://client.example/callback', code_verifier: flow.verifier, resource: h.config.resource }) });
}

export async function connect(h, token = h.dashboard()) {
  const { client } = await register(h);
  const flow = await begin(h, client);
  const { body } = await approve(h, flow, token);
  const final = await finish(h, flow, body.proof);
  const url = new URL(final.headers.get('location'));
  const response = await exchange(h, client, flow, url.searchParams.get('code'));
  return { client, flow, callback: url, response, tokens: await response.json() };
}
