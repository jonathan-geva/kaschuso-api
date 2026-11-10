import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import queueModule from '../../services/account-queue.js';

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

test('school service logging contains no usernames or raw cookie-jar logging', async () => {
  const source = await readFile(new URL('../../services/kaschuso-api.js', import.meta.url), 'utf8');
  assert.equal(/console\.(?:log|warn|error)\([^;\n]*\+ username/.test(source), false);
  assert.equal(/console\.warn\([^\n]*mergedCookies\[SAL_COOKIE_JAR_RAW_KEY\]/.test(source), false);
});
