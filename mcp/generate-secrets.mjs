import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), use: 'sig', alg: 'RS256' };
const values = {
  MCP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  MCP_LOOKUP_KEY: randomBytes(32).toString('base64'),
  MCP_COOKIE_KEY: randomBytes(32).toString('base64'),
  MCP_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
};
writeFileSync('.env.mcp.local', Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Created ignored .env.mcp.local with private file permissions. No secret values are printed.');
