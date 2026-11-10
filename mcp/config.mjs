import { secretKey } from './crypto.mjs';

export function readConfig(env = process.env) {
  if (env.ENABLE_MCP && !['true', 'false'].includes(env.ENABLE_MCP)) throw new Error('ENABLE_MCP must be true or false');
  if (env.ENABLE_MCP !== 'true') return { enabled: false };
  try {
    const publicUrl = new URL(env.MCP_PUBLIC_URL);
    const frontendUrl = new URL(env.MCP_FRONTEND_URL);
    for (const url of [publicUrl, frontendUrl]) {
      const local = env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    }
    if (!env.DATABASE_URL) throw new Error();
    secretKey(env.MCP_ENCRYPTION_KEY);
    secretKey(env.MCP_LOOKUP_KEY);
    secretKey(env.MCP_COOKIE_KEY);
    if (new Set([env.MCP_ENCRYPTION_KEY, env.MCP_LOOKUP_KEY, env.MCP_COOKIE_KEY, env.JWT_SECRET]).size !== 4) throw new Error();
    const jwks = JSON.parse(env.MCP_SIGNING_JWKS);
    if (!Array.isArray(jwks.keys) || !jwks.keys.some(k => k.d && k.kid)) throw new Error();
    return {
      enabled: true, publicUrl: publicUrl.origin, frontendUrl: frontendUrl.origin,
      resource: `${publicUrl.origin}/mcp`, issuer: `${publicUrl.origin}/oauth`,
      databaseUrl: env.DATABASE_URL, encryptionKey: env.MCP_ENCRYPTION_KEY, lookupKey: env.MCP_LOOKUP_KEY,
      cookieKey: env.MCP_COOKIE_KEY, jwks, secure: publicUrl.protocol === 'https:',
    };
  } catch { throw new Error('Invalid enabled MCP configuration; see setup documentation'); }
}
