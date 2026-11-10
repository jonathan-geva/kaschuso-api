# ChatGPT grades implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement isolated, read-only multi-student grade access from ChatGPT, with no real personal data in source, tests, docs, or plugin metadata.

**Architecture:** Extend the existing Express backend with an OAuth server, encrypted PostgreSQL persistence, account-bound MCP tools, and the existing dashboard's connection/consent UI. Keep MCP feature-gated and the dashboard REST contract stable. Use opaque account identifiers and token separation.

**Tech stack:** Node.js 24, oidc-provider 9, official MCP SDK 2, PostgreSQL/pg, React/Vite, Zod, existing Jest plus node:test and real-browser checks.

**Spec:** `docs/superpowers/specs/2026-11-10-chatgpt-grades-design.md`

## Global constraints

- Ten-minute access tokens, five-minute authorization interactions/codes, thirty-day absolute connection expiry.
- S256 PKCE, strict resource/client/scope binding, single-use consent completion and code consumption, atomic refresh rotation/replay handling, immediate revocation.
- Encrypt retained school credentials and OAuth model payloads; do not persist grades. No persistent credentials for ordinary dashboard login.
- MCP tools derive identity exclusively from their authenticated connection. Dashboard tokens and MCP tokens are not interchangeable.
- School passwords only enter through the existing JSON authentication endpoint; browser bearer state stays in memory.
- Use synthetic names, accounts, school/course identifiers, dates, locations, tokens and credentials in fixtures. No creator name or identifying account string in added content/metadata; Git attribution and repository account references are the user-authorized exceptions.
- Existing production hosting stays intact. No paid provisioning, production merge, or publication as an incidental implementation step.

## Review focus

- Shared/copy-pasted authorization links must never attach the approving student's account to the initiator's different browser.
- Concurrent token exchanges must not allow code or refresh replay; database outages must fail closed.
- The same school username across different schools and simultaneous students must remain isolated.
- An existing logged-in dashboard session must not bypass explicit account consent or turn a cancelled flow into a durable credential record.
- Source strings, logs, build artifacts, configuration examples, and optional plugin metadata must not reveal real personal data.

### Task 1: Encrypted storage and deployment configuration

**Files:** `mcp/config.mjs`, `mcp/crypto.mjs`, `mcp/store.mjs`, `mcp/migrations/001.sql`, `mcp/migrate.mjs`, `mcp/tests/store.test.mjs`, package/lock/runtime files.

**Interfaces:** `readConfig(env)` validates enabled settings; `createVault(key)` returns `seal(value,aad)`, `open(value,aad)`, and `lookup(value)`. `Store(pool,vault)` provides migrations, encrypted OAuth adapter operations, connected-account/connection lookup/revocation, pending consent proof completion, and cleanup. PostgreSQL is the only production store.

- [ ] Write failing tests for encryption/context/key mismatch, strict configuration, atomic model consumption, restart persistence, concurrent proof claims, and account lookup isolation.
- [ ] Run `npm run test:mcp -- --test-name-pattern=store`; confirm missing modules fail before implementing.
- [ ] Implement schema/vault/store/config with parameterized SQL, transaction boundaries, hashed model IDs, encrypted payloads and expiring rows.
- [ ] Run storage tests against local PostgreSQL; expect all pass. Commit this deliverable.

### Task 2: OAuth server and bound consent handoff

**Files:** `mcp/oauth.mjs`, `mcp/connections.mjs`, `mcp/tests/oauth.test.mjs`, middleware integration in `app.js` and existing auth middleware.

**Interfaces:** `createIntegration({config,pool,school})` exposes OAuth discovery/router, dashboard consent/connection router, and `authenticateMcp(token)` returning `{accountId,grantId,clientId,credentials,expiresAt}`. Consent receives an existing dashboard-authenticated session. A one-time proof is returned only to its consenting browser; top-level POST/redirect verifies the original interaction cookie before granting.

- [ ] Write failing integration tests for real OAuth discovery/registration/authorization/PKCE, cookie+proof binding, denied consent, expiry, scope/resource rejection, token separation, concurrent code/refresh use, and revocation.
- [ ] Run targeted tests and observe missing integration fail.
- [ ] Use oidc-provider with a persistent encrypted adapter, opaque tokens, no user-info/profile scope, strict HTTPS redirect metadata and S256 policy, independent stable cookie/signing secrets, safe errors and registration limits.
- [ ] Implement consent flow with server-resolved school identity, no third-party-cookie dependency, per-connection expiry, account-bound revocation and explicit reconnect outcomes.
- [ ] Verify against local PostgreSQL and record all results before commit.

### Task 3: Grade tools and privacy-safe school integration

**Files:** `mcp/grades.mjs`, `mcp/server.mjs`, `mcp/tests/grades.test.mjs`, `mcp/tests/mcp.test.mjs`, affected school-service/auth/logging code.

**Interfaces:** `gradeOverview(subjects)`, `subjectGrades(subjects,subjectRef)`, `projectGrade(subjects,input)` return bounded, validated, non-identifying grade data. `createMcpHandler` binds callbacks to verified connection credentials. School boundary exposes `getGrades` and `getUnconfirmedGrades`; tests substitute synthetic data there only.

- [ ] Write failing tests for Swiss date/decimal normalization, missing/unsupported/zero weights, class-average separation, ambiguous subjects, out-of-scale projections, and real MCP tool discovery/calls for two isolated accounts.
- [ ] Observe failures, then implement four read-only tools with strict schemas and safe error mapping. Remove usernames from reached logs; add bounded upstream timeouts and same-account serialization.
- [ ] Prove unauthorized/mismatched/revoked tokens cannot invoke tools and fake identity fields cannot override the token account. Run existing parser/middleware tests and new tests; commit only green changes.

### Task 4: Existing dashboard connection and revocation UI

**Files (dashboard):** `src/features/connections/{api,components,routes}/*`, auth login components, router, shared API schemas/client, existing settings dialog, tests/scripts as needed.

**Interfaces:** `/connect` preserves an opaque interaction identifier in memory through login; shared API methods retrieve display details, submit authenticated consent, and list/revoke owned connections. Browser sends completion proof only in a top-level form POST body to a fixed configured backend URL.

- [ ] Add a failing browser scenario for login→consent→OAuth callback, plus copied-link rejection, cancellation, reconnect and settings revocation.
- [ ] Reuse the existing selector/login UI and in-memory session; add minimal connection page and settings section without exposing creator identity or storing credentials in browser storage.
- [ ] Run frontend lint/build and browser scenarios, including cross-origin frontend/backend behavior. Expect existing login/dashboard and new flows to work. Commit frontend changes.

### Task 5: Operational docs, companion skill and privacy audit

**Files:** `docs/chatgpt-mcp.md`, `.env.production.example`, `render.yaml`, `plugin/*`, test/security automation, affected existing sensitive-data locations.

**Interfaces:** Setup uses public placeholder URLs and generated secrets written to ignored local files; migrations are explicit. Plugin source contains domain instructions and only a verified endpoint when deployed; do not install a placeholder connection.

- [ ] Document enable/disable, database migration, stable secret generation/rotation, expiry/deletion, custom-connection setup, reconnect/revoke, and verification boundaries.
- [ ] Add a companion grade-interpretation skill and validate its manifest/frontmatter without creator identity or real account data.
- [ ] Scan both repositories (including historical-looking fixtures in current files) for secrets, names, contact/location/birth details and teacher-coded course tokens; replace real identifying content with synthetic equivalents while preserving coverage.
- [ ] Run all backend suites, frontend lint/build, local OAuth/MCP/browser flow, production startup/feature-off checks and relevant dependency audit. Record exact evidence.

### Task 6: Independent security/code review and reviewable handoff

**Files:** final feature branches in both repositories.

- [ ] Dispatch a fresh whole-change reviewer with the spec, this plan, privacy constraint, test results and both branch ranges; require actionable security/correctness findings.
- [ ] Reproduce important findings with failing regression tests, fix them, then run the affected suite and full required checks.
- [ ] Commit verified changes and create linked draft PRs through the available GitHub connection without merging main. Report production database/secret/account-linking setup still required; never claim live-school or ChatGPT verification without observing it.
