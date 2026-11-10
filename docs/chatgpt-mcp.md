# Connect school grades to ChatGPT

The backend includes opt-in, read-only MCP access. The existing dashboard provides the school sign-in, explicit consent, and connected-app revocation screens. Each student connects their own school account. The companion interpretation skill lives in `plugin/`; it does not create or authenticate an MCP connection by itself.

## Deploy

Use Node.js 24 and PostgreSQL. Deploy the matching backend and dashboard changes before enabling the integration. Keep `ENABLE_MCP=false` during rollout; the existing REST dashboard works without MCP storage or secrets.

Configure these **backend** settings through hosting secret/environment settings:

| Setting | Purpose |
| --- | --- |
| `ENABLE_MCP=true` | Enable the OAuth and MCP endpoints |
| `DATABASE_URL` | Persistent PostgreSQL connection, using the provider's verified TLS settings |
| `MCP_PUBLIC_URL` | Canonical backend HTTPS origin, for example `https://backend.example` |
| `MCP_FRONTEND_URL` | Canonical dashboard HTTPS origin, for example `https://dashboard.example` |
| `MCP_ENCRYPTION_KEY` | Independent base64-encoded 32-byte authenticated-encryption key |
| `MCP_LOOKUP_KEY` | Independent base64-encoded 32-byte opaque-identifier lookup key |
| `MCP_COOKIE_KEY` | Independent base64-encoded 32-byte OAuth cookie-signing key |
| `MCP_SIGNING_JWKS` | Private signing JWK set with a stable RSA signing key and `kid` |

Keep the existing `JWT_SECRET` and `FRONTEND_ORIGIN` settings. Production requires an independent, randomly generated dashboard signing secret of at least 32 bytes and rejects placeholder secrets. Include the dashboard's exact origin in `FRONTEND_ORIGIN`. The dashboard's public `VITE_API_BASE_URL` points to the backend; no database URL or secret belongs in a frontend variable.

Generate the four independent MCP secrets locally with `npm run mcp:secrets`. This creates an ignored `.env.mcp.local` file with mode `0600` and refuses to overwrite it. Copy its values directly into backend secret settings; do not paste them into chat, documentation, issues or commits. Keep a secure backup of the encryption and lookup keys. The generator does not print their values.

Before enabling traffic, run the explicit migration with the configured backend environment:

```sh
npm run mcp:migrate
```

Startup verifies the schema and encryption/lookup keys. It does not silently migrate, generate replacement keys or fall back to memory. Missing storage or mismatched keys prevent enabled MCP startup. Database failures deny access and return generic errors. Preserve HTTPS and database certificate verification. Do not expose the backend's direct ingress as an alternative to the configured trusted reverse proxy; forwarding host/protocol headers must match the canonical origin.

## Student account linking

In a ChatGPT account/workspace that supports custom MCP connections, add the canonical backend URL with `/mcp`, select OAuth, and request `grades:read`. The server provides authorization metadata, dynamic registration and S256 PKCE. Availability of custom connections depends on the student's ChatGPT plan/workspace settings. This release does not submit a public directory listing.

ChatGPT opens the dashboard's `/connect` page. The student checks the requesting app and callback origin, signs in to their school account, and explicitly allows read-only access. The approval browser must be the browser that started the connection. Copied links in another browser fail safely. Cancel works before sign-in. Completion uses a one-time proof in a POST body plus the original signed browser-interaction cookie; it does not depend on cross-site fetch cookies.

Access tokens last ten minutes. Refresh tokens rotate on use and each connection expires absolutely after thirty days. A code or refresh-token replay revokes that grant. Dashboard bearer tokens are not valid MCP tokens. Tool arguments cannot select another student.

Students can disconnect an app in dashboard settings. Access stops immediately, including for a tool call whose upstream request is still finishing. The last active connection's removal deletes retained school credentials and clears cached upstream cookies. A changed/rejected school password marks the account as requiring reconnection. Disconnect and start a new connection through ChatGPT to update it.

## Retention and privacy

School credentials are retained only after explicit account-linking consent. They and OAuth model payloads use authenticated encryption with row-specific associated data. Identifier lookups are keyed hashes. Normal dashboard sign-in does not create a persistent credential record. Subject and assessment data are retrieved on request and are not stored in PostgreSQL. Responses never include the student's school password, access token or profile/contact details.

Expired grants are unusable at expiry. Cleanup removes expired state on startup and every minute while the service runs; a sleeping service performs cleanup when it resumes. Orphaned, incomplete credential records have a short cleanup grace period. Physical backup retention follows the database provider's policy. Production access and hosting backups must be restricted by the operator.

Keep source and test data synthetic. The repository privacy checker reports locations/categories without printing matching values. It checks known author names outside Git, common credential/session literals and non-example emails. It complements manual review for names, birth/location details, internal identifiers and teacher-coded course labels; it cannot prove the absence of every possible identifying string.

MCP-enabled operation disables school HTML/debug dumps. Access logs omit paths, queries, bodies and identifiers. Do not collect live school traces as part of normal operation. The dashboard service worker excludes authenticated/API/OAuth/connection responses from its cache and respects private/no-store responses.

### Secret rotation

Do not replace encryption, lookup or cookie keys silently. For this first release, rotation intentionally requires reconnecting all students: disable MCP, revoke/purge OAuth grants, connected accounts and pending decisions using a controlled database maintenance operation, retain no old encrypted credential rows, replace the keys/signing JWK set, initialize a new `mcp_meta` vault check with the migration, then re-enable and reconnect. This is an operator maintenance procedure, not an automatic startup action. Coordinate backup expiry and keep any old key needed by retained backups in the operator's secret store. A future re-encryption tool can provide rotation without reconnection.

## Tools and interpretation

- `get_grade_overview`: current subject averages and assessment counts with opaque references.
- `get_subject_grades`: paginated exam names, source dates/grades/points/weights, and separately supplied class averages.
- `get_unconfirmed_grades`: the distinct awaiting-confirmation feed; exam dates do not establish upload order.
- `calculate_grade_projection`: exact-target estimate from visible numeric grades and supported weights. Missing weights, unknown rounding rules and school promotion/compensation rules are never inferred.

The optional portable plugin source contains the interpretation skill and neutral project attribution. Add a portable `mcp.json` only after verifying the deployed endpoint and its OAuth connection; never package private credentials or an unverified placeholder connection. Installation alone does not verify account linking or live grade retrieval.

## Local verification

Install backend dependencies with the existing Yarn lockfile and frontend dependencies with `npm ci`. Start a local PostgreSQL database at the test connection URL, or set `TEST_DATABASE_URL` to a dedicated test database. Tests create and drop isolated schemas, so never point that variable at a production database.

```sh
npm test -- --runInBand
npm run test:mcp
npm run check:privacy
```

In the dashboard checkout:

```sh
npm run lint
npm run build
npx playwright install chromium
KASCHUSO_API_DIR=/absolute/path/to/backend npm run test:e2e
```

The default test database is a local PostgreSQL service on `127.0.0.1:55432`, database `kaschuso_test`, test role `postgres`. Browser checks start loopback-only synthetic school data, real PostgreSQL/OAuth/MCP, and a temporary self-signed local HTTPS callback. Only the browser fixture accepts that test certificate. Production TLS verification remains enabled. The fixture refuses production mode and contains no real student identity.

Fixture tests establish protocol/security behavior, not live school availability or live ChatGPT compatibility. A final live check requires a student to sign in through the deployed connection UI and verify tool discovery plus a grade query in ChatGPT. Never request credentials in chat to perform that check.
