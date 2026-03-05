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

## Overview

This project is an Express server (`app.js`) with route handlers in `routes/api/` and scraping logic in `services/kaschuso-api.js`.

Default local address:

- `http://localhost:3001`

## Requirements

- Node.js 14+ (project Dockerfile uses Node 14)
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
curl -i http://localhost:3001/api/authenticate
```

## Configuration

Config is loaded via `dotenv`.

Available variables:

- `PORT`: server port (default `3001`)
- `KASCHUSO_BASE_URL`: base URL (default `https://kaschuso.so.ch/`)

Example `.env`:

```env
PORT=3001
KASCHUSO_BASE_URL=https://kaschuso.so.ch/
```

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

### `GET /api/authenticate`

Query params:

- `mandator`
- `username`
- `password`

Returns whether credentials are valid.

### `GET /api/user/info`

Query params:

- `mandator`
- `username`
- `password`

Returns user profile information.

### `GET /api/grades`

Query params:

- `mandator`
- `username`
- `password`

Returns parsed subjects and grades.

### `GET /api/absences`

Query params:

- `mandator`
- `username`
- `password`

Returns absence entries.

## Example Calls

Use `--data-urlencode` to avoid shell escaping issues.

Authenticate:

```bash
curl --get 'http://localhost:3001/api/authenticate' \
	--data-urlencode 'mandator=YOUR_MANDATOR' \
	--data-urlencode 'username=YOUR_USERNAME' \
	--data-urlencode 'password=YOUR_PASSWORD'
```

Get grades:

```bash
curl --get 'http://localhost:3001/api/grades' \
	--data-urlencode 'mandator=YOUR_MANDATOR' \
	--data-urlencode 'username=YOUR_USERNAME' \
	--data-urlencode 'password=YOUR_PASSWORD'
```

Get absences:

```bash
curl --get 'http://localhost:3001/api/absences' \
	--data-urlencode 'mandator=YOUR_MANDATOR' \
	--data-urlencode 'username=YOUR_USERNAME' \
	--data-urlencode 'password=YOUR_PASSWORD'
```

Get user info:

```bash
curl --get 'http://localhost:3001/api/user/info' \
	--data-urlencode 'mandator=YOUR_MANDATOR' \
	--data-urlencode 'username=YOUR_USERNAME' \
	--data-urlencode 'password=YOUR_PASSWORD'
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
	"authenticated": true
}
```

Authenticate failure:

```json
{
	"mandator": "gibsso",
	"username": "your.user",
	"authenticated": false
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
- Use `--data-urlencode` for curl parameters.
- If password contains special chars (for example `!`), avoid direct URL strings.

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

- This API currently accepts credentials via query string for compatibility with existing routes.
- Query strings can end up in logs, browser history, and reverse proxy logs.
- Prefer running this behind HTTPS and a trusted internal network.
- For production hardening, migrate endpoints to `POST` body payloads and redact sensitive fields in logs.

## Credits

This project is a rebuilt and fixed version of the original KASCHUSO API wrapper.

Original source:

- https://github.com/KaschusoSystems/kaschuso-api
