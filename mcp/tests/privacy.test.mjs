import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import queueModule from '../../services/account-queue.js';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';

const require = createRequire(import.meta.url);

test('school operations serialize the same account but not different accounts', async () => {
  const { runAccount } = queueModule;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started = false;
  const first = runAccount('school-a', 'SYNTHETIC_A', () => pending);
  const second = runAccount('school-a', 'SYNTHETIC_A', async () => { started = true; return 2; });
  assert.equal(await runAccount('school-b', 'SYNTHETIC_A', async () => 3), 3);
  assert.equal(started, false);
  release(1);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
});

for (const mandator of ['school-a', 'gymli']) {
  test(`failed ${mandator === 'gymli' ? 'SAL' : 'legacy'} authentication logs only safe diagnostics`, async () => {
    const axios = require('axios').default;
    const original = { get: axios.get, post: axios.post, spawn: childProcess.spawnSync, log: console.log, warn: console.warn, error: console.error, mcp: process.env.ENABLE_MCP, debug: process.env.SAL_DEBUG };
    const entries = [];
    try {
      process.env.ENABLE_MCP = 'true';
      process.env.SAL_DEBUG = 'true';
      childProcess.spawnSync = () => ({ status: 1, stdout: '', stderr: 'SYNTHETIC_UPSTREAM_SESSION SYNTHETIC_STUDENT_MARKER' });
      console.log = console.warn = console.error = (...values) => entries.push(JSON.stringify(values));
      axios.get = async url => ({ status: 200, cookies: {}, data: String(url).includes('ses.js') ? "var bid = getBid('abcdef');" : '<form name="LoginForm"><input name="password" type="password"></form>' });
      axios.post = async () => ({ status: 200, cookies: {}, locationValue: '/login?sid=SYNTHETIC_UPSTREAM_SESSION', data: '<title>SYNTHETIC_STUDENT_MARKER</title><span class="sls-global-errors-msg">SYNTHETIC_STUDENT_MARKER SYNTHETIC_UPSTREAM_SESSION</span>' });
      const modulePath = require.resolve('../../services/kaschuso-api.js');
      delete require.cache[modulePath];
      const school = require(modulePath);
      await assert.rejects(school.authenticate(mandator, 'SYNTHETIC_LOG_ACCOUNT', 'SYNTHETIC_PASSWORD'));
      const captured = entries.join('\n');
      for (const marker of ['SYNTHETIC_STUDENT_MARKER', 'SYNTHETIC_UPSTREAM_SESSION', 'SYNTHETIC_LOG_ACCOUNT', 'SYNTHETIC_PASSWORD']) assert.equal(captured.includes(marker), false, 'Private upstream material reached a log sink');
    } finally {
      axios.get = original.get; axios.post = original.post; childProcess.spawnSync = original.spawn;
      console.log = original.log; console.warn = original.warn; console.error = original.error;
      if (original.mcp === undefined) delete process.env.ENABLE_MCP; else process.env.ENABLE_MCP = original.mcp;
      if (original.debug === undefined) delete process.env.SAL_DEBUG; else process.env.SAL_DEBUG = original.debug;
      delete require.cache[require.resolve('../../services/kaschuso-api.js')];
    }
  });
}

test('school service logging contains no usernames or raw cookie-jar logging', async () => {
  const source = await readFile(new URL('../../services/kaschuso-api.js', import.meta.url), 'utf8');
  assert.equal(/console\.(?:log|warn|error)\([^;\n]*\+ username/.test(source), false);
  assert.equal(/console\.warn\([^\n]*mergedCookies\[SAL_COOKIE_JAR_RAW_KEY\]/.test(source), false);
});
