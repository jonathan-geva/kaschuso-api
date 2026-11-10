import 'dotenv/config';
import pg from 'pg';
import { readConfig } from './config.mjs';
import { createVault } from './crypto.mjs';
import { Store } from './store.mjs';

const config = readConfig(process.env);
if (!config.enabled) throw new Error('Set ENABLE_MCP=true before migrating');
const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
try {
  await new Store(pool, createVault(config.encryptionKey, config.lookupKey)).migrate();
  console.log('MCP schema and storage-key verification complete');
} finally { await pool.end(); }
