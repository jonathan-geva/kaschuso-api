# Project Guidelines

## Deployment

**Production Environment:**
- **URL**: https://kaschuso-api.onrender.com
- **Platform**: Render (free tier)
- **Service ID**: srv-d6tvs9euk2gs7393bia0
- **Auto-deploy**: Enabled on GitHub `main` branch push
- **Critical Env Vars**:
  - `JWT_SECRET` (strong, required)
  - `FRONTEND_ORIGIN=https://kaschuso-dashboard.pages.dev` (CORS)
  
**Local Development:**
- `PORT=3001` (default)
- `FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173` for Vite frontend

## Architecture
- Entry point is `app.js` (Express app, middleware, error handlers, route mounting).
- API routes are under `routes/api/` and should stay thin: parse request params, call service functions, return JSON.
- Core logic belongs in `services/kaschuso-api.js` (authentication, cookies, scraping, parsing).
- Parser behavior is validated with fixtures in `__test__/` and tests in `services/kaschuso-api.test.js`.

## Authentication Flow (Critical)

The upstream KASCHUSO portal requires:

1. **Bootstrap Session** (`basicAuthenticate()`): GET root URL, capture `SCDID_S` session cookie.
2. **Fetch Form + CSRF Token**: GET login form page + `ses.js` (both with session cookie, parallel).
3. **Merge Cookies**: Combine cookies from steps 1-2 before login POST.
4. **Submit Login**: POST with:
   - All accumulated cookies in `Cookie` header
   - Browser-like headers (`Origin`, `Referer`)
   - All form input fields (via `getLoginPayloadFromHtml()`)
   - BID parameter from `ses.js` (see `getActionFromSesJs()`)
5. **Validate Session**: Check for `SCDID_S` cookie in response. If present → authenticated. If not → check for inline error message (span class `sls-global-errors-msg`).

**Key Insights:**
- Session cookie (`SCDID_S`) is critical at every step; forgetting to carry it forward will cause login to fail.
- Wrong credentials return HTTP 200 (NOT 302) with an inline German error message. This is classified as `INVALID_CREDENTIALS` by checking for `.sls-global-errors-msg` element.
- The BID parameter in `ses.js` changes on each fetch; use regex `/var bid = getBid\('([A-Fa-f0-9]+)'\)/` to extract it.
- `currentRequestedPage` is a hidden form field that must be preserved from the form HTML.

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
- For scraping changes, support both legacy and current KASCHUSO HTML where practical.
- When updating parsers, add or update fixture-based tests in `services/kaschuso-api.test.js`.

## Scraping Pitfalls
- Do not reintroduce legacy browser fingerprint headers in `DEFAULT_HEADERS`; upstream can return `403`.
- `/api/mandators` may legitimately return an empty list because upstream no longer reliably exposes mandator links.
- Redirect handling matters for upstream fetches; changing `maxRedirects` can break parsing.
- Cheerio often normalizes `tbody`; prefer selectors that work with inserted table wrappers.
- Cookie values may contain `=` signs; parse carefully with `indexOf('=')` not `split('=')[1]`.
- Session cookies may rotate between requests; always merge and forward accumulated cookies.

## Security And Logging
- Credentials must be accepted only via `POST /api/authenticate` JSON body (never via query params).
- Protected endpoints must require bearer token auth and must reject credential query params.
- Production deployments require explicit `JWT_SECRET` and `FRONTEND_ORIGIN` configuration.
- `FRONTEND_ORIGIN` may contain a comma-separated allowlist; CORS responses must echo a single matching origin, never a comma-joined value.
- For local Vite development, support both `http://localhost:5173` and `http://127.0.0.1:5173` where practical.
- Keep password redaction behavior in request logging intact.
- Do not commit secrets or real user credentials into code, tests, or docs.
