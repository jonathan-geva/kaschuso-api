# Qualification Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add private semester history and source-cited BM/EFZ target planning to the dashboard and MCP.

**Architecture:** Keep two existing repositories. The backend owns history and pure qualification calculations; REST and MCP share that engine. The React frontend renders canonical outputs and sends explicit hypothetical scenarios.

**Tech Stack:** Existing Node24/Express/Cheerio/MCP, React19/TypeScript/TanStack Query/Tailwind. No third repository or paid infrastructure.

**Spec:** `docs/qualification-design.md`

## Global Constraints

- Only the GIBS Solothurn Informatiker EFZ Applikationsentwicklung/BM1 TALS profile now; profile files and fixture tests support later contributions.
- Never commit real credentials, worksheet values, source HTML, school identity or class/teacher identifiers.
- Missing grades remain null; computed portal-derived certificate estimates and target scenarios remain provisional.
- Authenticated history reads restore original semester in finally; preserve OAuth isolation and revocation.
- Keep free Render/Neon plans. Do not change schema or deploy secrets unnecessarily.

## Review Focus

- Global future semester options must not be mistaken for student history.
- Cross-semester module repetitions must not double count experience grades.
- Rounded running averages must not become official pass/fail declarations.
- IDAF performance pairs and NW component marks require explicit grouping and complete inputs.
- Editing a target must not lose upstream failure messages or mix cached accounts.

## Task 1 — Semester history

Files: `services/grade-history.js`, `services/kaschuso-api.js`, `routes/api/grade-history.js`, route registration, synthetic Jest tests.
- [x] Add failing tests for semester parsing, trusted action URLs, bounds, restoration on success/failure, cache isolation and serialization.
- [x] Run targeted tests; implement exported `getGradeHistory(mandator,username,password,options={})` and privacy-safe route using the design contract.
- [x] Pass tests and current-grade regression suite; verify old/current source semester consistency privately.

## Task 2 — Pure qualification rules

Files: `qualification/index.js`, `qualification/profiles/gibs-so-informatik-bm-2021.js`, synthetic unit tests, research docs.
- [x] Add failing tests for null/zero parsing, Swiss scale, half-up rounding, BM/BFS separation, NW, IDAF, exam/final stages, incomplete data, module deduplication and target feasibility.
- [x] Implement `buildQualification(history,scenario={})`, `validateScenario(input)` and `getRules()` with the exact design response fields.
- [x] Pass tests using synthetic eight-semester fixtures; document explicit unsupported official/certificate/repetition cases.

## Task 3 — Frontend planner

Files: frontend `src/features/qualification/*`, dashboard/history integration, API schemas/endpoints/query keys, fixture browser tests.
- [x] Render fixture-backed semester history, separate BM/BFS averages, BM worksheet target table and EFZ aggregation panel; use the backend response contract.
- [x] Debounce validated scenarios; avoid persistent student data; preserve partial errors and account clearing.
- [x] Add synthetic browser coverage for missing/estimated grades, target changes, mobile tables and the discreet chatbot setup panel.
- [x] Pass lint/build/browser checks.

## Task 4 — REST, MCP and setup guidance

Files: protected qualification routes, `mcp/server.mjs`, `mcp/instructions.mjs`, companion skill, public Markdown setup routes/docs.
- [x] Add tests for scenario validation, OAuth account binding, revocation during history work and unchanged existing tools.
- [x] Wire canonical engine into REST/new MCP tools with initialization instructions; support documented trusted client origins and standard loopback callback handling without broad CORS or credential forwarding.
- [x] Add source-cited client setup instructions and copyable Markdown served without secrets.
- [x] Verify ChatGPT flow as far as available authorisation allows, and label other client compatibility untested live.

## Task 5 — Integration, privacy review and PR delivery

- [x] Run backend unit/MCP/security checks and frontend lint/build/browser checks with synthetic data.
- [x] Perform authorised live history/planner smoke test with no recording or published data; delete private captures.
- [x] Scan source and diffs for exact private values without echoing matches; review calculation limitations and docs.
- [ ] Review both branches, fix findings, commit and create/attach coordinated PRs. Preserve production until the authorised release workflow applies.
