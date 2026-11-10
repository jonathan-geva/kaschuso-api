import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountIntegration } from '../index.mjs';
import express from 'express';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

test('disabled MCP mounts status without database credentials or live school access', async () => {
  const app = express();
  const integration = await mountIntegration(app, { env: {} });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/mcp/status`)).json(), { enabled: false });
    assert.equal((await fetch(`${base}/mcp`)).status, 404);
  } finally { await integration.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('production dashboard auth rejects weak signing secrets', () => {
  const code = `require(${JSON.stringify(fileURLToPath(new URL('../../routes/api/middleware/auth.js', import.meta.url)))})`;
  const run = secret => spawnSync(process.execPath, ['-e', code], { env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: secret }, stdio: 'pipe' });
  assert.notEqual(run('weak').status, 0);
  assert.equal(run(randomBytes(48).toString('base64')).status, 0);
});
