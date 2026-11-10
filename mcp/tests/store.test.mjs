import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createVault } from '../crypto.mjs';
import { readConfig } from '../config.mjs';
import { Store } from '../store.mjs';

const vault = createVault(randomBytes(32).toString('base64'), randomBytes(32).toString('base64'));
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/kaschuso_test', options: `-c search_path=${schema}` });
const store = new Store(pool, vault);
before(async () => { await pool.query(`CREATE SCHEMA ${schema}`); await store.migrate(); });
after(async () => { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });

test('vault authenticates ciphertext, account context, and encryption key', () => {
  const sealed = vault.seal({ password: 'SYNTHETIC_PASSWORD' }, 'account-a');
  assert.equal(JSON.stringify(sealed).includes('SYNTHETIC_PASSWORD'), false);
  assert.deepEqual(vault.open(sealed, 'account-a'), { password: 'SYNTHETIC_PASSWORD' });
  assert.throws(() => vault.open(sealed, 'account-b'));
  const other = createVault(randomBytes(32).toString('base64'), randomBytes(32).toString('base64'));
  assert.throws(() => other.open(sealed, 'account-a'));
  assert.equal(vault.lookup('account-a'), vault.lookup('account-a'));
});

test('MCP disabled configuration needs no secrets; enabled configuration rejects insecure defaults', () => {
  assert.equal(readConfig({}).enabled, false);
  assert.throws(() => readConfig({ ENABLE_MCP: 'true' }), /configuration/i);
  assert.throws(() => readConfig({ ENABLE_MCP: 'typo' }), /ENABLE_MCP/);
});

test('OAuth state is encrypted, hashed, persisted, and consumed atomically', async () => {
  const Adapter = store.adapter();
  const adapter = new Adapter('AuthorizationCode');
  const code = randomBytes(32).toString('base64url');
  await adapter.upsert(code, { accountId: 'synthetic-account', grantId: 'grant-a' }, 300);
  assert.equal((await adapter.find(code)).accountId, 'synthetic-account');
  const rows = await pool.query('SELECT * FROM mcp_oauth_models');
  assert.equal(JSON.stringify(rows.rows).includes(code), false);
  assert.equal(JSON.stringify(rows.rows).includes('synthetic-account'), false);
  const freshStore = new Store(pool, vault);
  const freshAdapter = new (freshStore.adapter())('AuthorizationCode');
  assert.equal((await freshAdapter.find(code)).accountId, 'synthetic-account');
  const results = await Promise.allSettled([adapter.consume(code), adapter.consume(code)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected').length, 1);
  assert.equal(await freshAdapter.find(code), undefined, 'replay revokes the whole grant');
});

test('school identity is isolated and credentials only survive with an active connection', async () => {
  const a = await store.saveAccount({ mandator: 'school-a', username: 'SYNTHETIC_STUDENT', password: 'SYNTHETIC_PASSWORD' });
  const b = await store.saveAccount({ mandator: 'school-b', username: 'SYNTHETIC_STUDENT', password: 'SYNTHETIC_PASSWORD' });
  assert.notEqual(a, b);
  await store.saveConnection({ grantId: 'test-grant-a', accountId: a, clientId: 'client-a' });
  await store.saveConnection({ grantId: 'test-grant-b', accountId: a, clientId: 'client-b' });
  assert.equal((await store.activeConnection('test-grant-a')).credentials.mandator, 'school-a');
  await store.revokeConnection('test-grant-a', a);
  assert.equal(await store.activeConnection('test-grant-a'), undefined);
  assert.ok(await store.activeConnection('test-grant-b'));
  await store.revokeConnection('test-grant-b', a);
  assert.equal((await pool.query('SELECT count(*) FROM mcp_accounts WHERE id=$1', [a])).rows[0].count, '0');
});

test('completion proof is consumed once and bound to its interaction', async () => {
  const proof = await store.saveDecision('interaction-a', { denied: true });
  assert.equal(await store.claimDecision('interaction-b', proof), undefined);
  const attempts = await Promise.all([store.claimDecision('interaction-a', proof), store.claimDecision('interaction-a', proof)]);
  assert.equal(attempts.filter(Boolean).length, 1);
});

test('a restarted store refuses a mismatched encryption key', async () => {
  const wrong = new Store(pool, createVault(randomBytes(32).toString('base64'), randomBytes(32).toString('base64')));
  await assert.rejects(wrong.migrate());
});

test('abandoned authorization connections and credentials are cleaned after the interaction window', async () => {
  const id = await store.saveAccount({ mandator: 'school-a', username: 'SYNTHETIC_ABANDONED', password: 'SYNTHETIC_PASSWORD' });
  await store.saveConnection({ grantId: 'synthetic-abandoned-grant', accountId: id, clientId: 'synthetic-client' });
  await pool.query("UPDATE mcp_accounts SET updated_at=now()-interval '6 minutes' WHERE id=$1", [id]);
  await pool.query("UPDATE mcp_connections SET created_at=now()-interval '6 minutes' WHERE account_id=$1", [id]);
  await store.cleanup();
  assert.equal(await store.activeConnection('synthetic-abandoned-grant'), undefined);
  assert.equal((await pool.query('SELECT 1 FROM mcp_accounts WHERE id=$1', [id])).rowCount, 0);
});
