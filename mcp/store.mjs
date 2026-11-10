import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { errors } from 'oidc-provider';

const CONNECTION_MS = 30 * 24 * 60 * 60 * 1000;

export class Store {
  constructor(pool, vault) { this.pool = pool; this.vault = vault; }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async migrate() {
    const sql = await readFile(new URL('./migrations/001.sql', import.meta.url), 'utf8');
    await this.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(7429181)');
      await db.query(sql);
      const { rows } = await db.query("SELECT value FROM mcp_meta WHERE id='vault-check'");
      if (rows.length) {
        if (this.vault.open(rows[0].value, 'vault-check') !== this.vault.lookup('vault-check')) throw new Error('MCP storage keys do not match');
      } else {
        await db.query("INSERT INTO mcp_meta(id,value) VALUES('vault-check',$1)", [this.vault.seal(this.vault.lookup('vault-check'), 'vault-check')]);
      }
    });
  }

  adapter() {
    const store = this;
    return class EncryptedAdapter {
      constructor(model) { this.model = model; }
      key(id) { return store.vault.lookup(`${this.model}:${id}`); }
      async upsert(id, payload, expiresIn) {
        const key = this.key(id);
        const encrypted = store.vault.seal(payload, `${this.model}:${key}`);
        const expires = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
        if (this.model === 'ReplayDetection') {
          const result = await store.pool.query('INSERT INTO mcp_oauth_models(model,key_hash,payload,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [this.model, key, encrypted, expires]);
          if (!result.rowCount) throw new errors.InvalidGrant('Replay rejected');
          return;
        }
        await store.pool.query(`INSERT INTO mcp_oauth_models(model,key_hash,payload,grant_id,uid_hash,user_code_hash,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(model,key_hash) DO UPDATE SET payload=EXCLUDED.payload,
          grant_id=EXCLUDED.grant_id,uid_hash=EXCLUDED.uid_hash,user_code_hash=EXCLUDED.user_code_hash,expires_at=EXCLUDED.expires_at`,
        [this.model, key, encrypted, payload.grantId || null, payload.uid ? store.vault.lookup(payload.uid) : null, payload.userCode ? store.vault.lookup(payload.userCode) : null, expires]);
      }
      async findWhere(column, value) {
        const { rows } = await store.pool.query(`SELECT * FROM mcp_oauth_models WHERE model=$1 AND ${column}=$2 AND (expires_at IS NULL OR expires_at>now())`, [this.model, value]);
        const row = rows[0];
        if (!row) return undefined;
        const result = store.vault.open(row.payload, `${this.model}:${row.key_hash}`);
        if (row.consumed_at) result.consumed = Math.floor(row.consumed_at.getTime() / 1000);
        return result;
      }
      find(id) { return this.findWhere('key_hash', this.key(id)); }
      findByUid(uid) { return this.findWhere('uid_hash', store.vault.lookup(uid)); }
      findByUserCode(code) { return this.findWhere('user_code_hash', store.vault.lookup(code)); }
      async consume(id) {
        const result = await store.pool.query(`UPDATE mcp_oauth_models SET consumed_at=now() WHERE model=$1 AND key_hash=$2 AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING grant_id`, [this.model, this.key(id)]);
        if (!result.rowCount) {
          const prior = await store.pool.query('SELECT grant_id FROM mcp_oauth_models WHERE model=$1 AND key_hash=$2', [this.model, this.key(id)]);
          if (prior.rows[0]?.grant_id) await store.revokeConnection(prior.rows[0].grant_id);
          throw new errors.InvalidGrant('Grant already used or expired');
        }
      }
      async destroy(id) { await store.pool.query('DELETE FROM mcp_oauth_models WHERE model=$1 AND key_hash=$2', [this.model, this.key(id)]); }
      async revokeByGrantId(id) { await store.revokeConnection(id); }
    };
  }

  locator(credentials) {
    return this.vault.lookup(JSON.stringify([String(credentials.mandator).toLowerCase(), credentials.username]));
  }

  async saveAccount(credentials) {
    const locator = this.locator(credentials);
    return this.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [locator]);
      const prior = await db.query('SELECT id FROM mcp_accounts WHERE locator=$1', [locator]);
      const id = prior.rows[0]?.id || randomUUID();
      await db.query(`INSERT INTO mcp_accounts(id,locator,credentials) VALUES($1,$2,$3)
        ON CONFLICT(locator) DO UPDATE SET credentials=EXCLUDED.credentials,reconnect=false,updated_at=now()`, [id, locator, this.vault.seal(credentials, `account:${id}`)]);
      return id;
    });
  }

  async saveConnection({ grantId, accountId, clientId }) {
    await this.pool.query('INSERT INTO mcp_connections(grant_id,account_id,client_id,expires_at) VALUES($1,$2,$3,$4)', [grantId, accountId, clientId, new Date(Date.now() + CONNECTION_MS)]);
  }

  async activeConnection(grantId) {
    const { rows } = await this.pool.query(`SELECT c.*,a.credentials,a.reconnect FROM mcp_connections c JOIN mcp_accounts a ON a.id=c.account_id WHERE c.grant_id=$1 AND c.revoked_at IS NULL AND c.expires_at>now()`, [grantId]);
    const row = rows[0];
    if (!row) return undefined;
    return { accountId: row.account_id, clientId: row.client_id, grantId, expiresAt: row.expires_at, reconnect: row.reconnect, credentials: this.vault.open(row.credentials, `account:${row.account_id}`) };
  }

  async listConnections(credentials) {
    const { rows } = await this.pool.query(`SELECT c.grant_id AS id,c.client_id AS "clientId",c.created_at AS "createdAt",c.expires_at AS "expiresAt",a.reconnect FROM mcp_connections c JOIN mcp_accounts a ON a.id=c.account_id WHERE a.locator=$1 AND c.revoked_at IS NULL AND c.expires_at>now() ORDER BY c.created_at`, [this.locator(credentials)]);
    return rows;
  }

  async revokeConnection(grantId, accountId) {
    return this.transaction(async db => {
      const args = [grantId];
      if (accountId) args.push(accountId);
      const locked = await db.query(`SELECT account_id FROM mcp_connections WHERE grant_id=$1${accountId ? ' AND account_id=$2' : ''} FOR UPDATE`, args);
      if (accountId && !locked.rowCount) return false;
      await db.query("DELETE FROM mcp_oauth_models WHERE grant_id=$1 OR (model='Grant' AND key_hash=$2)", [grantId, this.vault.lookup(`Grant:${grantId}`)]);
      await db.query('DELETE FROM mcp_connections WHERE grant_id=$1', [grantId]);
      if (locked.rows[0]) await db.query(`DELETE FROM mcp_accounts a WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM mcp_connections c WHERE c.account_id=a.id AND c.revoked_at IS NULL AND c.expires_at>now())`, [locked.rows[0].account_id]);
      return true;
    });
  }

  async revokeOwned(grantId, credentials) {
    const account = await this.pool.query('SELECT id FROM mcp_accounts WHERE locator=$1', [this.locator(credentials)]);
    if (!account.rows[0]) return false;
    return this.revokeConnection(grantId, account.rows[0].id);
  }

  async markReconnect(accountId) { await this.pool.query('UPDATE mcp_accounts SET reconnect=true WHERE id=$1', [accountId]); }

  async saveDecision(interaction, decision) {
    const proof = randomBytes(32).toString('base64url');
    const key = this.vault.lookup(interaction);
    await this.pool.query('INSERT INTO mcp_decisions(interaction_hash,proof_hash,payload,expires_at) VALUES($1,$2,$3,now()+interval \'5 minutes\')', [key, this.vault.lookup(proof), this.vault.seal(decision, `decision:${key}`)]);
    return proof;
  }

  async claimDecision(interaction, proof) {
    const key = this.vault.lookup(interaction);
    const { rows } = await this.pool.query('DELETE FROM mcp_decisions WHERE interaction_hash=$1 AND proof_hash=$2 AND expires_at>now() RETURNING payload', [key, this.vault.lookup(proof)]);
    return rows[0] ? this.vault.open(rows[0].payload, `decision:${key}`) : undefined;
  }

  async decisionExists(interaction) {
    return (await this.pool.query('SELECT 1 FROM mcp_decisions WHERE interaction_hash=$1 AND expires_at>now()', [this.vault.lookup(interaction)])).rowCount > 0;
  }

  async cleanup() {
    await this.transaction(async db => {
      await db.query('DELETE FROM mcp_decisions WHERE expires_at<=now()');
      await db.query('DELETE FROM mcp_oauth_models WHERE expires_at<=now()');
      await db.query('DELETE FROM mcp_connections WHERE expires_at<=now() OR revoked_at IS NOT NULL');
      await db.query(`DELETE FROM mcp_accounts a WHERE updated_at<now()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM mcp_connections c WHERE c.account_id=a.id)`);
    });
  }
}
