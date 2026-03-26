# Project Guidelines

## Deployment

**Production Environment:**
- **URL**: https://kaschuso-api.onrender.com
- **Platform**: Render (free tier)
- **Auto-deploy**: Enabled on GitHub `main` branch push
- **Critical Env Vars**:
  - `JWT_SECRET` (strong, required)
  - `FRONTEND_ORIGIN=https://kaschuso-dashboard.pages.dev` (CORS)
  
**Local Development:**
- `PORT=3001` (default)
- `FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173` for Vite frontend
- SAL rollout can be enabled via `ENABLE_SAL_PORTAL=true` (base: `SAL_BASE_URL=https://portal.sbl.ch/`), currently exposing `gymli`.

## Architecture
- Entry point is `app.js` (Express app, middleware, error handlers, route mounting).
- API routes are under `routes/api/` and should stay thin: parse request params, call service functions, return JSON.
- Core logic belongs in `services/kaschuso-api.js` (authentication, cookies, scraping, parsing).
- Parser behavior is validated with fixtures in `__test__/` and tests in `services/kaschuso-api.test.js`.

## Authentication Flow (Critical)

The service supports two portal modes:

### KASCHUSO (Legacy)

1. **Bootstrap Session** (`basicAuthenticate()`): GET root URL, capture `SCDID_S` session cookie.
2. **Fetch Form + CSRF Token**: GET login form page + `ses.js` (both with session cookie, parallel).
3. **Merge Cookies**: Combine cookies from steps 1-2 before login POST.
4. **Submit Login**: POST with:
   - All accumulated cookies in `Cookie` header
   - Browser-like headers (`Origin`, `Referer`)
   - All form input fields (via `getLoginPayloadFromHtml()`)
   - BID parameter from `ses.js` (see `getActionFromSesJs()`)
5. **Validate Session**: Check for `SCDID_S` cookie in response. If present → authenticated. If not → check for inline error message (span class `sls-global-errors-msg`).

Key insights:
- Session cookie (`SCDID_S`) is critical at every step; forgetting to carry it forward causes login failure.
- Wrong credentials return HTTP 200 (NOT 302) with an inline German error message (`INVALID_CREDENTIALS` classification via `.sls-global-errors-msg` element).
- BID parameter in `ses.js` changes on each fetch; use regex `/var bid = getBid\('([A-Fa-f0-9]+)'\)/` to extract.
- `currentRequestedPage` is a hidden form field that must be preserved.

### SAL (Modern Portal, GymLi)

1. **Hangup Session** (optional): Clear any stale BIG-IP sessions via `vdesk/hangup.php3`.
2. **Bootstrap + Login POST**: Both handled by curl-based `authenticateViaSalPortalWithCurl()`:
   - GET `/my.policy` to capture session cookies
   - POST `/my.policy` with credentials
   - Follow SAML redirect chain to webtop
   - Capture session cookies (SimpleSAML, MRHSession, etc.)
3. **Avoid Destructive Probes**: Do NOT re-request the Webtop or homepage immediately after auth—F5 may trigger a logout/reset.
4. **Lazy Homepage Fetch**: Homepage is accessed only when needed for page links (in `getHomepageAndHeaders`).
5. **Retry on Logout**: If homepage returns a logout shell, automatically re-authenticate once and retry.

Key insights:
- SAL uses modern F5/APM policy flow; `ses.js` and `SCDID*` cookies do NOT apply.
- Curl-backed authentication is used to match browser-like cookie jar semantics; Node HTTP clients can trigger false F5 policy failures.
- Re-accessing Webtop or homepage immediately after auth may cause F5 to reset the session with "Access policy check is already running" or explicit logout.
- Session validity is checked conservatively: assume fresh auth is valid; only re-auth if `getHomepageAndHeaders` detects a logout shell.
- User-Agent header must be set for resource_list requests; missing it may return HTML instead of XML.
- In some F5 environments, the `resource_info_v2` endpoint can reset connections; it is opt-in via `SAL_USE_RESOURCE_INFO=false` (default).

## Build And Test
- Install dependencies with `yarn install` (or `npm install`).
- Start server with `yarn start`.
- Use auto-reload with `yarn dev`.
- Run tests with `yarn test`.
- Stop local server on port 3001 with `npm run stop`.
- If `.env` is missing, create it from `.env.default`.

## Conventions
- Keep route files minimal and delegate business logic to `services/kaschuso-api.js`.
- Prefer `async/await` and preserve existing error propagation (`catch(next)` in routes).
- Keep API response shapes stable unless explicitly changing contract.
- Use `/api/meta` for frontend bootstrap metadata (feature flags + effective mandators) rather than hardcoding deployment assumptions.
- For scraping changes, support both legacy and current KASCHUSO HTML where practical.
- When updating parsers, add or update fixture-based tests in `services/kaschuso-api.test.js`.
- Sanitize fixtures before committing them: replace student names, teacher-coded course tokens, phone numbers, emails, credentials, birth dates, postal codes (PLZ/ZIP), and hometown values with generic placeholders whenever possible.

## Scraping Pitfalls
- Do not reintroduce legacy browser fingerprint headers in `DEFAULT_HEADERS`; upstream can return `403`.
- `/api/mandators` should primarily discover mandator slugs from `https://kaschuso.so.ch/robots.txt` and merge with curated metadata.
- Keep fallback order for mandator discovery: `robots.txt` -> root-page HTML links -> curated list.
- Alias slugs may appear upstream (for example `kbssogr`); normalize to canonical slugs (`kbsso`) before returning API output.
- Redirect handling matters for upstream fetches; changing `maxRedirects` can break parsing.
- Cheerio often normalizes `tbody`; prefer selectors that work with inserted table wrappers.
- Cookie values may contain `=` signs; parse carefully with `indexOf('=')` not `split('=')[1]`.
- Session cookies may rotate between requests; always merge and forward accumulated cookies.
- The homepage `Ihre letzten Noten` table is a separate unconfirmed/latest-uploaded feed and should not be treated as identical to the full grades page semantics.
- `gymli` lives on `portal.sbl.ch` and may render table detail rows with fewer columns than classic KASCHUSO pages; parser logic must remain resilient to both shapes.
- SAL user profile tables may use label aliases (for example `Name Vorname`, `Strasse`, `PLZ Ort`, `Profil`) instead of legacy keys; parser logic should map aliases without breaking existing responses.
- SAL homepage may occasionally return logout shells (`"pageType": "logout"`) even after successful auth; this triggers automatic re-authentication in `getHomepageAndHeaders`.
- Parsed user info for SAL (`gymli`) may have missing fields (e.g., `address`, `education`, `class`) depending on schulNetz field visibility; do not assume all fields are populated.

### Absences Parsing
- SAL absences tables contain nested colspan rows separating point-incident sections; use `getDirectRows()` to query only direct `<tbody>` → `<tr>` children, skipping nested detail tables.
- Use header-index mapping (`findHeaderIndex()`) instead of hard positional cell indices; SAL table columns may vary and reordering is common.
- Incident details ("Zu dieser Absenz erfassten Meldungen") appear in nested tables or as pipe-separated text under each incident row; parse with `extractIncidentDetailsFromRow()` and normalize to `AbsenceDetailEntry[]`.
- Tardiness counter summary ("Entschuldigt: X | Unentschuldigt: Y") sometimes arrives as "0 | 0" despite rows with "Ja"/"Nein" values being present; implement fallback: if summary is zero/zero and rows exist, parse boolean cells directly with `normalizeBooleanLike()` and derive counts.
- Absence points are stored in a dedicated `points` column; extract and preserve in API response; frontend uses these for display and tab count logic.
- Contingent points (`contingentUsed`, `contingentRemaining`) should be extracted from a summary section if present; use safe numeric parsing to handle missing/invalid values.

## Reference Files

- Main API entry point and route mounting: `app.js`
- Core scraping and parsing logic (authentication, absences, grades, user info): `services/kaschuso-api.js`
- Test suite with fixtures and regression tests (absences, grades, login flows): `services/kaschuso-api.test.js`
- Absences endpoint handler: `routes/api/absences.js`
- Authentication endpoint handler (422 failure classification): `routes/api/authenticate.js`
- Grades endpoint handler: `routes/api/grades.js`
- API middleware (auth guard, rate limiting, request validation): `routes/api/middleware/`


- This repository is publicly available on GitHub; never publish secrets, deploy hooks, tokens, credentials, private identifiers, or other privacy-related information in code, docs, tests, commits, or generated content.
- Credentials must be accepted only via `POST /api/authenticate` JSON body (never via query params).
- Protected endpoints must require bearer token auth and must reject credential query params.
- `GET /api/unconfirmed-grades` follows the same bearer-token protection and must not accept credentials via query params.
- Production deployments require explicit `JWT_SECRET` and `FRONTEND_ORIGIN` configuration.
- `FRONTEND_ORIGIN` may contain a comma-separated allowlist; CORS responses must echo a single matching origin, never a comma-joined value.
- For local Vite development, support both `http://localhost:5173` and `http://127.0.0.1:5173` where practical.
- Keep password redaction behavior in request logging intact.
- Do not commit secrets or real user credentials into code, tests, or docs.
