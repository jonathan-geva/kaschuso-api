# kaschuso-api

API wrapper for `kaschuso.so.ch`.

This service exposes a small HTTP API to authenticate against KASCHUSO and fetch:

- user info
- grades
- absences
- mandators (best effort, see caveats)

## Table of Contents

1. Overview
2. Requirements
3. Quick Start
4. Configuration
5. Run Modes
6. API Endpoints
7. Example Calls
8. Response Shapes
9. Troubleshooting
10. Development
11. Docker
12. Security Notes
13. Publish Gate

## Overview

This project is an Express server (`app.js`) with route handlers in `routes/api/` and scraping logic in `services/kaschuso-api.js`.

Default local address:

- `http://localhost:3001`

## Requirements

- Node.js 20+ (project Dockerfile uses Node 20-alpine)
- npm or yarn
- Internet access to `https://kaschuso.so.ch/`

## Quick Start

1. Install dependencies.

```bash
yarn install
```

or

```bash
npm install
```

2. Create a local env file.

```bash
cp .env.default .env
```

For production deployments, start from the production template:

```bash
cp .env.production.example .env
```

3. Start the server.

```bash
yarn start
```

or

```bash
npm start
```

4. Verify the API is reachable.

```bash
curl -i http://localhost:3001/health
```

## Configuration

Config is loaded via `dotenv`.

Available variables:

- `PORT`: server port (default `3001`)
- `KASCHUSO_BASE_URL`: base URL (default `https://kaschuso.so.ch/`)
- `FRONTEND_ORIGIN`: allowed CORS origin (required in production)
- `JWT_SECRET`: token signing secret (required in production)
- `API_SESSION_TTL_SECONDS`: token/session lifetime (default `900`)
- `API_RATE_LIMIT_WINDOW_MS`: global rate-limit window (default `60000`)
- `API_RATE_LIMIT_MAX`: global rate-limit max requests (default `120`)
- `API_AUTH_RATE_LIMIT_WINDOW_MS`: auth route rate-limit window (default `300000`)
- `API_AUTH_RATE_LIMIT_MAX`: auth route rate-limit max requests (default `10`)

Example `.env`:

```env
PORT=3001
KASCHUSO_BASE_URL=https://kaschuso.so.ch/
FRONTEND_ORIGIN=https://app.example.com
JWT_SECRET=change-me
```

Local frontend example (Vite):

```env
FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
```

Production template: `.env.production.example`

## Run Modes

Start production mode:

```bash
yarn start
```

Start dev mode with auto-reload:

```bash
yarn dev
```

Run tests:

```bash
yarn test
```

Stop process on port 3001:

```bash
npm run stop
```

## API Endpoints

Base path: `/api`

### `GET /health` and `GET /api/health`

Simple readiness/liveness probes for local and hosted deployments.

Example:

```bash
curl -i http://localhost:3001/health
```

### `GET /api/mandators`

Returns a list of available mandators.

Note: On current upstream KASCHUSO pages, mandators may not be publicly listed anymore. In that case this endpoint returns an empty array.

### `POST /api/authenticate`

JSON body:

- `mandator`
- `username`
- `password`

Returns whether credentials are valid and issues a short-lived bearer token.

### `GET /api/user/info`

Headers:

- `Authorization: Bearer <token>`

Returns user profile information.

### `GET /api/grades`

Headers:

- `Authorization: Bearer <token>`

Returns parsed subjects and grades.

### `GET /api/absences`

Headers:

- `Authorization: Bearer <token>`

Returns absence entries.

## Example Calls

Authenticate:

```bash
curl -X POST 'http://localhost:3001/api/authenticate' \
  -H 'Content-Type: application/json' \
  -d '{"mandator":"YOUR_MANDATOR","username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'
```

Get grades:

```bash
curl 'http://localhost:3001/api/grades' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Get absences:

```bash
curl 'http://localhost:3001/api/absences' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Get user info:

```bash
curl 'http://localhost:3001/api/user/info' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Get mandators:

```bash
curl 'http://localhost:3001/api/mandators'
```

## Response Shapes

Authenticate success:

```json
{
	"mandator": "gibsso",
	"username": "your.user",
	"authenticated": true,
	"token": "<jwt>",
	"expiresIn": 900
}
```

Authenticate failure:

```json
{
	"mandator": "gibsso",
	"username": "your.user",
	"authenticated": false,
	"reason": "AUTHENTICATION_FAILED",
	"detail": "The upstream login did not accept the provided credentials."
}
```

Grades response:

```json
{
	"mandator": "example-school",
	"username": "student.username",
	"subjects": [
		{
			"class": "CLASS_CODE",
			"name": "Subject Name",
			"average": "5.0",
			"grades": [
				{
					"date": "01.01.2026",
					"name": "Exam 1",
					"value": "5.5",
					"points": "18",
					"weighting": "1",
					"average": "5.2"
				}
			]
		}
	]
}
```

## Troubleshooting

### `authenticated: false`

- Verify `mandator`, username, and password.
- Ensure you call `POST /api/authenticate` with a JSON body.

## Publish Gate

Run this checklist before public deployment.

1. Dependency and runtime checks.

```bash
yarn install
yarn audit --groups dependencies
yarn test --runInBand
```

Expected:

- `0 vulnerabilities found` in dependency audit
- all tests pass

2. Production startup smoke test.

```bash
PORT=3001 NODE_ENV=production JWT_SECRET=replace-me FRONTEND_ORIGIN=https://app.example.com timeout 15s yarn start
```

Expected:

- server starts with `Listening on port 3001`

3. Live health checks.

```bash
curl -sS http://localhost:3001/health
curl -sS http://localhost:3001/api/health
```

Expected payload for both:

```json
{"status":"ok"}
```

4. Authorization guard checks.

```bash
curl -i http://localhost:3001/api/grades
```

Expected:

- `401` response with `UNAUTHORIZED`

5. Environment requirements for production.

- `NODE_ENV=production`
- `JWT_SECRET` must be set
- `FRONTEND_ORIGIN` must be set to your frontend origin
- Prefer HTTPS at ingress/reverse proxy with HSTS enabled

6. Container build (where Docker is available).

```bash
docker build -t kaschuso-api:release .
```

Expected:

- image builds without errors on Node 20 runtime


### `subjects: []` for grades

- Ensure authentication is true first.
- Upstream HTML can change. This project includes parser support for legacy and newer KASCHUSO layout, but future upstream changes can still break scraping.

### `/api/mandators` returns empty list

- Current upstream often no longer exposes mandator links publicly.
- Use a known mandator directly (for example from your school docs).

### Upstream/network issues

- Confirm access to `https://kaschuso.so.ch/`.
- Check proxy variables (`http_proxy`, `https_proxy`, `no_proxy`).
- Retry later if upstream rate limits or blocks suspicious traffic.

### CORS issues

- Ensure `FRONTEND_ORIGIN` includes the exact frontend origin (protocol + host + port).
- If you use both host variants locally, include both: `http://localhost:5173,http://127.0.0.1:5173`.
- Restart the backend after changing `.env`.
- Browser CORS checks require `Access-Control-Allow-Origin` to match a single request origin exactly.

### Service health check

- Verify app process is alive with `curl -i http://localhost:3001/health`.

## Development

Project layout:

- `app.js`: Express app bootstrap
- `routes/api/*.js`: HTTP route handlers
- `services/kaschuso-api.js`: scraping/authentication logic
- `__test__/`: fixtures and parser tests

Run tests:

```bash
yarn test
```

## Docker

Build image:

```bash
docker build -t kaschuso-api .
```

Run container:

```bash
docker run --rm -p 3001:3001 --env-file .env kaschuso-api
```

## Security Notes

- Credentials are accepted only via `POST /api/authenticate` JSON body.
- Protected endpoints require `Authorization: Bearer <token>`.
- Do not send credentials in query parameters.
- Always deploy behind HTTPS and set `JWT_SECRET` + `FRONTEND_ORIGIN` in production.
- Do not commit secrets or real credentials.

## Credits

This project is a rebuilt and fixed version of the original KASCHUSO API wrapper.

Original source:

- https://github.com/KaschusoSystems/kaschuso-api
