# Project Guidelines

## Architecture
- Entry point is `app.js` (Express app, middleware, error handlers, route mounting).
- API routes are under `routes/api/` and should stay thin: parse request params, call service functions, return JSON.
- Core logic belongs in `services/kaschuso-api.js` (authentication, cookies, scraping, parsing).
- Parser behavior is validated with fixtures in `__test__/` and tests in `services/kaschuso-api.test.js`.

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

## Security And Logging
- Credentials must be accepted only via `POST /api/authenticate` JSON body (never via query params).
- Protected endpoints must require bearer token auth and must reject credential query params.
- Production deployments require explicit `JWT_SECRET` and `FRONTEND_ORIGIN` configuration.
- Keep password redaction behavior in request logging intact.
- Do not commit secrets or real user credentials into code, tests, or docs.
