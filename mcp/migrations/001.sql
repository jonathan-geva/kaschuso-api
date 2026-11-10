CREATE TABLE IF NOT EXISTS mcp_meta (id text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_oauth_models (
  model text NOT NULL, key_hash text NOT NULL, payload text NOT NULL,
  grant_id text, uid_hash text, user_code_hash text,
  expires_at timestamptz, consumed_at timestamptz,
  PRIMARY KEY (model, key_hash)
);
CREATE INDEX IF NOT EXISTS mcp_oauth_grant_idx ON mcp_oauth_models(grant_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_uid_idx ON mcp_oauth_models(model, uid_hash);
CREATE TABLE IF NOT EXISTS mcp_accounts (
  id uuid PRIMARY KEY, locator text UNIQUE NOT NULL, credentials text NOT NULL,
  reconnect boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_connections (
  grant_id text PRIMARY KEY, account_id uuid NOT NULL REFERENCES mcp_accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_connections_account_idx ON mcp_connections(account_id);
ALTER TABLE mcp_connections ADD COLUMN IF NOT EXISTS authorization_completed boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS mcp_decisions (
  interaction_hash text PRIMARY KEY, proof_hash text UNIQUE NOT NULL, payload text NOT NULL,
  expires_at timestamptz NOT NULL
);
