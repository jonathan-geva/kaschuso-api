import pg from 'pg';
import { readConfig } from './config.mjs';
import { createVault } from './crypto.mjs';
import { Store } from './store.mjs';
import { createOAuth } from './oauth.mjs';
import { mountMcp } from './server.mjs';

export async function mountIntegration(app, { env = process.env, school, requireDashboard } = {}) {
  const config = readConfig(env);
  app.get('/api/mcp/status', (_req, res) => res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).json({ enabled: config.enabled }));
  if (!config.enabled) {
    app.all('/mcp', (_req, res) => res.status(404).json({ error: 'NOT_ENABLED' }));
    return { close: async () => {} };
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, query_timeout: 5000 });
  pool.on('error', () => console.error('MCP database temporarily unavailable'));
  try {
    const store = new Store(pool, createVault(config.encryptionKey, config.lookupKey), { onOrphan: credentials => school.clearAccount(credentials.mandator, credentials.username) });
    await store.verify();
    await store.cleanup();
    const oauth = await createOAuth({ config, store, requireDashboard });
    app.use(oauth.router);
    const handler = mountMcp(app, { config, oauth, store, school });
    const timer = setInterval(() => store.cleanup().catch(() => console.error('MCP maintenance temporarily unavailable')), 60000);
    timer.unref();
    return { close: async () => { clearInterval(timer); await handler.close(); await pool.end(); } };
  } catch (error) { await pool.end(); throw error; }
}
