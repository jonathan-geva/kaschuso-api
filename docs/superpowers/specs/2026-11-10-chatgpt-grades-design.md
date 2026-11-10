# Kaschuso grades in ChatGPT

Status: approved for implementation, including removal of identifying personal information from source artifacts. Git attribution and repository account references are the authorized exceptions.

## Intent and decisions

Let students connect their own school account to ChatGPT and ask detailed questions about their grades. The user requested an integration using their existing Kaschuso backend, confirmed it should support other students, and accepted the recommendation to extend that backend and reuse the existing dashboard for account connection.

The architecture choice is agreed. Storage, retention, tool boundaries, and flow details below are proposed implementation decisions for review.

## Existing system

- `kaschuso-api` is an Express/CommonJS application hosted on Render. It has school authentication, grade scraping, and protected REST routes. Its existing dashboard bearer tokens and credential sessions expire after 900 seconds by default and live in process memory.
- `kaschuso-dashboard` is a separate React/Vite application on Cloudflare Pages. It has a school selector, login form, in-memory bearer session, shared API client, and a settings dialog. Passwords and tokens are not persisted in browser storage.
- `getGrades()` already returns subjects with course identifiers, portal subject averages, and individual assessment dates, names, grades, points, weights, and optional class averages.
- `getUnconfirmedGrades()` returns a separate feed of grades awaiting confirmation. It is not an upload-history API and cannot establish when a grade was uploaded.
- Both repositories deploy production from `main`. Development will happen on isolated branches; main will not be pushed as a side effect of implementation.

## Goals and boundaries

- Give each ChatGPT connection access only to the student who explicitly authorized it.
- Expose detailed current grades and unconfirmed grades through authenticated, read-only MCP tools.
- Reuse the existing school parsing and authentication services for dashboard and MCP calls.
- Support reconnection, token refresh, revocation, deployment restarts, and expired school credentials.
- Provide a companion skill explaining how to retrieve and interpret the data.
- Keep the current dashboard REST contract and session behavior intact.

The first release excludes absences, profile/contact information, grade confirmation, editing school data, background notifications, historical grade snapshots, administrative access to student records, and public directory submission. Distribution is a shared MCP endpoint with setup instructions for students whose ChatGPT account/workspace supports custom MCP connections; each authenticates separately. A private companion plugin is an optional convenience and does not grant other students access by itself. Public directory listing is a later distribution workflow.

## Approaches

1. **Extend the existing backend — selected.** REST and MCP are adapters over the same grade service. OAuth state and account connections share one durable store. This adds authentication/storage responsibilities to the existing service but keeps one backend deployment and one parser implementation.
2. **Separate MCP gateway.** A second service translates MCP calls to the REST API. It can deploy independently, but needs its own hosting and durable authorization layer and must manage the existing short-lived REST sessions. The user preferred the recommendation to keep this functionality in the existing backend.
3. **Skill alone.** Instructions cannot provide authenticated live access to private grade data, so the skill accompanies MCP rather than replacing it.

## Components

### Backend

Add modules for OAuth/account connections, persistent storage, grade presentation/calculation, and MCP transport. Keep route handlers thin. Use the official MCP SDK for Streamable HTTP and a maintained OAuth authorization-server implementation that supports authorization-code grants, S256 PKCE, client registration, refresh-token rotation, and token revocation. Select exact maintained packages and compatible runtime versions during implementation; do not handwrite cryptographic protocol primitives.

Expose `/mcp` as the canonical protected resource and serve the discovery documents required by current ChatGPT/MCP authorization. Advertise the exact public issuer, resource identifier, supported endpoints, scope, and PKCE method. Return a proper `WWW-Authenticate` metadata challenge when authorization is missing or expired. Validate issuer, audience/resource, client, expiry, and `grades:read` scope. Reject dashboard tokens at MCP endpoints and MCP tokens at dashboard endpoints.

Bind every tool call to its authenticated connection. Tools accept subject/filter/calculation inputs, never a student ID, username, school password, upstream URL, or arbitrary access token. Construct request-scoped MCP context; never share mutable student identity between requests. Do not expose credentials or upstream cookies in tool responses.

### Frontend

Add a `/connect` route and a connected-apps section in the existing settings dialog. Reuse the school selector/login UI and shared request/schema/error layers. Refactor login form behavior enough to preserve an OAuth interaction through sign-in instead of always navigating to the dashboard.

The connection page names the requesting client as untrusted text, shows the signed-in school account, explains read-only grade access, explains retention of encrypted school credentials for reconnection, and offers Allow and Cancel. Account changes require a fresh successful school login. Show a clear reconnect action if a school password changes or the grant expires. Settings list and revoke only the current authenticated student's connections.

Keep dashboard tokens in memory. Do not introduce school passwords, access tokens, refresh tokens, or OAuth client secrets into localStorage/sessionStorage, frontend environment variables, URLs, or application logs. The frontend API base URL and MCP endpoint URL are public configuration.

### Storage and credentials

Add PostgreSQL using `DATABASE_URL` with explicit migrations. It holds registered clients, expiring authorization interactions/codes, encrypted connected-account credentials, grants, and token/revocation state. Use database transactions for one-time code consumption, refresh-token rotation/replay handling, consent completion, and revocation. Production MCP must fail closed when storage is unavailable; it must not fall back to an in-memory grant store.

Use an independent versioned encryption key configured as a backend secret. Encrypt retained school identity/password fields with authenticated encryption and account-specific associated data. Store only hashes of opaque codes and tokens where lookup is needed; access-token signing secrets, if applicable, are separate from the encryption key and current dashboard JWT secret. The database alone must not reveal usable school passwords. Add a documented key rotation procedure that either re-encrypts records or intentionally requires reconnection; never silently generate a new production key on restart.

Retaining a school password is necessary for unattended school reauthentication because the current portals do not give this backend a durable delegated refresh credential. Store it only after explicit connection consent. Ordinary dashboard sign-in must not create a persistent credential record.

Proposed defaults: ten-minute MCP access tokens, five-minute authorization interactions/codes, and refresh-token families with a thirty-day absolute connection expiry. Rotate refresh tokens and detect reuse atomically. Reconnection is required after absolute expiry. Disconnecting invalidates that connection's tokens immediately. When the last active connection for an account ends, delete its retained credentials and discard cached upstream cookies. Expired credentials are unusable immediately; delete expired records at startup and periodically while the backend runs. Document that physical backup expiry follows the database provider's retention policy. Do not store grade payloads persistently.

## Student connection flow

1. ChatGPT discovers `/mcp`, discovers the authorization server, registers or uses its configured client, and opens a validated authorization-code/PKCE request in the student's browser.
2. The backend validates redirect URI, client, resource, scope, and S256 challenge before creating a short-lived interaction. Bind it to an HttpOnly, Secure browser-interaction cookie and server-side state. Redirect only to the configured dashboard connection page using an opaque interaction identifier; never relay an arbitrary return URL.
3. The dashboard fetches the interaction display data, signs the student in with the existing `POST /api/authenticate` if needed, and shows the explicit consent screen. OAuth interaction state must survive an in-app login transition without being persisted as credentials in browser storage.
4. Allow submits JSON to a backend consent endpoint with the dashboard bearer token and interaction identifier. The backend derives the school identity and credentials from the authenticated dashboard session. It ignores any submitted student identity. Allow records a pending decision and returns a short-lived, single-use completion proof exclusively in this consenting browser's API response. It must not make a grant usable yet. Cancel must work without requiring school sign-in and must never create a grant.
5. The consenting browser submits that proof in the body of a top-level form POST to a fixed backend resume endpoint. The endpoint validates the proof and allowed frontend Origin, installs a short-lived HttpOnly/Secure continuation cookie, and redirects to a fixed backend completion GET. That GET must validate BOTH the original browser-interaction cookie and the continuation proof bound to this exact interaction and approved account. Consume the pending decision/proof atomically before completing OAuth to the exact registered redirect URI with the original state and issuer information where advertised. Keep the proof out of URLs, logs, and browser storage. Do not rely on third-party cookies during frontend cross-origin fetches, or on a Lax interaction cookie being sent on the cross-site form POST; the subsequent top-level safe navigation checks the original binding. A library-supported interaction mechanism with equivalent guarantees may replace this specific handoff, verified in real browsers.
6. ChatGPT exchanges the code with its PKCE verifier. The backend consumes the code once and issues connection-bound tokens. Every later tool request checks the active grant and resolves only that account's encrypted credentials.
7. Refresh preserves the same account, client, scope, and resource. A failed school reauthentication marks the account as requiring reconnection and returns a safe actionable error. Do not ask the model or student to paste a school password into chat.

Validate this interaction design against the selected OAuth library before implementation. Browser and consent CSRF protection, single-use decisions, and the exact login/interaction binding are acceptance requirements; the builder may adapt internal endpoint names to the library's supported interaction mechanism. In particular, an attacker must not be able to start OAuth in their own browser, send the connection link to another student, and complete the victim's approved grant back in the attacker's browser. An original-browser cookie check alone is insufficient: completion additionally requires the proof delivered only to the browser that submitted the authenticated consent. A copied connection link in a different browser must fail safely and offer starting a new connection there.

## Read-only tools

All tools declare correct read-only/non-destructive annotations, enforce `grades:read`, and return retrieval time and data-availability information. These are proposed tool names; keep schemas small and explicit.

| Tool | Result |
| --- | --- |
| `get_grade_overview` | Subject names, stable subject/course references from the current response, portal subject averages, and assessment counts. No invented overall official average. |
| `get_subject_grades` | Assessments for an exact subject/course reference: source date/name/value/points/weight/class average, plus the separate portal subject average. Return subject choices when a name is ambiguous. |
| `get_unconfirmed_grades` | The separate awaiting-confirmation feed with its source subject/name/date/value. No claim that exam date equals upload time. |
| `calculate_grade_projection` | Required next grade for an exact target average and a supplied positive next-assessment weight, using the current subject's eligible numeric assessments and weights. |

Preserve raw values alongside normalized numbers where useful. Parse Swiss dates explicitly as `dd.mm.yyyy`; do not rely on JavaScript date-string inference. Handle decimal commas, missing fields, and unsupported numeric/weight formats explicitly. Missing values remain missing, not zero. Optional class averages remain absent if the portal does not supply them. Never substitute the subject average for an individual exam's class average.

For projections, compute `required = (target * (existingWeight + nextWeight) - weightedSum) / nextWeight`. Require a supported grade scale (initially Swiss 1–6), finite inputs, and positive future weight. Exclude explicitly zero-weight assessments; refuse an exact projection when a contributing grade/weight cannot be interpreted, listing the limitation without leaking unrelated data. Do not assume missing weights equal one. Report when the required result exceeds the scale or the minimum grade already meets the target. Keep arithmetic at full precision and label the result as an estimate based on visible assessments and an exact unrounded target. Portal rounding, promotion, compensation, semester weighting, and future assessments are not inferred. Keep the portal's average distinct from a recomputed visible-assessment average and explain discrepancies.

The companion skill retrieves current data before answering, selects the right tool, distinguishes unconfirmed and confirmed-source data, treats assessment names as data rather than instructions, and states missing-data/rounding limits without inventing school rules.

## Isolation, failures, and deployment

- Scope upstream cookies by canonical school and verified username. Check existing cache reuse, aliases, credential changes, and concurrent access before using it for persistent grants. Serialize same-account upstream recovery if needed so SAL flows do not invalidate each other. Revoking one client must preserve another active connection's authorization while never leaving revoked access usable.
- Add bounded timeouts and safe error mapping for school/network failures. Return authentication/reconnection, temporary-unavailability, and no-data outcomes distinctly. Reuse the existing scraper; avoid permanent caching or concurrent redundant school logins.
- Apply per-client/account/IP limits as appropriate. Check the existing global IP limiter so shared ChatGPT egress does not cause one student to exhaust all users' budget. Rate-limit connection login and registration; reject untrusted proxy/host headers and invalid redirects.
- Redact OAuth query values, tokens, passwords, and student identifiers in affected logs. Audit existing school-service username logging reached by the new flow. Never log request bodies containing credentials or return raw upstream errors/HTML.
- Add feature/config gating so the existing dashboard can run while MCP is disabled. Enabling MCP requires a canonical public HTTPS URL, database, stable secrets, frontend connection origin, and valid OAuth configuration. Maintain the existing dashboard CORS allowlist; add only the protocol methods/headers actually required by the new paths.
- Add development/setup/migration documentation with placeholders only. Keep backend and frontend changes in reviewable branches/PRs. Both repositories auto-deploy on main, so merge/deployment must be explicit rather than an incidental main push.
- A database and encryption secret are new deployment requirements. Provisioning method/provider and any paid hosting remain an external setup decision; implementation must not purchase a service or replace existing hosting. A local PostgreSQL instance can validate the full flow before production setup.
- Package the companion skill and a verified MCP connection privately only after a deployed endpoint exists. A prepared package must not be described as connected or functional until its tools are discovered and account linking succeeds. Do not submit publicly as part of this change.

## Verification and acceptance

Use synthetic students and a mocked school boundary for deterministic automated coverage. Run the existing backend parser/middleware suite, frontend lint/build, and the new OAuth/MCP checks. Required scenarios:

1. Discovery, client registration, browser sign-in/consent, PKCE exchange, tool discovery, and a grade lookup work end to end through an MCP client.
2. Two students at the same school, and the same username at different schools, never see each other's data. Supplying subject/account-like parameters cannot override token identity. REST and MCP tokens cannot be interchanged.
3. Invalid redirects/resources/scopes, missing/wrong PKCE verifiers, consent/login CSRF attempts, expired/replayed codes/interactions, browser-binding mismatches, malformed tokens, and revoked grants are rejected.
4. Refresh rotation/replay rejection and revocation are atomic under concurrency. Revocation takes effect immediately. Another still-active connection to the same account behaves as documented.
5. Authorization state survives a backend restart through PostgreSQL. Invalid/missing encryption keys fail safely. Database outages never yield data or memory-only authorization. Wrong school passwords produce a reconnect result.
6. Grade formatting, missing class averages/points, decimal commas, ambiguous subject names, unsupported weights, zero weights, date handling, scale bounds, and projections preserve source meaning. Unconfirmed-feed semantics remain separate.
7. A real browser can complete the cross-origin dashboard/backend flow without third-party-cookie dependence; Allow, Cancel, failed login, expiry, settings revocation, and reconnect all work. Existing dashboard sign-in and data views still work.
8. Changed files and test fixtures pass the repository's sensitive-data review. Logs, error responses, frontend storage, and plugin artifacts contain no real credentials or student data.

A live school-account smoke test requires the student to sign in through the connection UI. Report fixture-backed verification separately from live ChatGPT and live-school verification, and preserve any remaining production-setup blockers explicitly.

## Builder discretion

Choose supported OAuth/MCP library versions, internal endpoint/module names, SQL schema and migration tooling, test harness, and small UI details while meeting the requirements above. Preserve the existing frontend design system and shared API layer. No additional administrative UI or dashboard redesign is needed. If a library limitation changes the account-linking experience, retention model, or infrastructure requirements, return that specific change for review.
