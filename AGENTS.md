# Backend agent guide

## Read first

- [Documentation map](docs/README.md) and [project README](README.md).
- [Qualification contract](docs/qualification-design.md) before changing history, grading or planner APIs.
- [OAuth/MCP operations](docs/chatgpt-mcp.md) before changing authentication, storage or tool delivery.
- [Profile contribution requirements](docs/qualification-contributing.md) and public research before changing formulas.
- [Copilot transport/parser conventions](.github/copilot-instructions.md) and [sensitive-data review workflow](.github/skills/sensitive-data-review/SKILL.md).

## Architecture and scope

Use Node 24. Express and school services are CommonJS; MCP integration is ESM. Keep the existing frontend/backend repositories. `qualification/index.js` is the pure calculation engine shared by REST and MCP; do not duplicate its formulas in adapters or clients. `qualification/profiles/` holds versioned, source-cited programme definitions. Only the GIBS Solothurn Informatiker EFZ Applikationsentwicklung BiVo 2021/pre-2026 eight-semester BM1 TALS profile is currently implemented. New professions/cohorts need explicit profiles and synthetic examples, not broader guessing in the existing profile.

`services/grade-history.js` owns trusted navigation, bounded account-specific caching and semester restoration. `services/kaschuso-api.js` supplies authenticated transport. History must use the existing account queue, validate portal-provided IDs/URLs, exclude future catalogue entries, verify the selected semester and restore original upstream state even on failure. Preserve restoration obligations and safe authentication classification. SAL history is unsupported; do not weaken origin restrictions to pretend otherwise.

## Privacy and authorisation

- Never put real accounts, credentials, tokens, filled worksheets, portal HTML, navigation tokens, teacher/class identifiers or student marks in source, fixtures, logs, screenshots, docs or plugin archives. Use invented fixtures. Git attribution and repository account references are permitted; neutral attribution belongs in distributable plugin files.
- Do not ask for school passwords in chat. Any specifically authorised live test must use private transient inputs, suppress sensitive diagnostics and remove temporary captures; do not run live tests as part of ordinary suites.
- REST identity comes from `requireAuth`; MCP identity comes only from its OAuth connection. Reject identity/credential selectors and unknown scenario keys. Dashboard and MCP tokens are not interchangeable.
- Recheck grant revocation after upstream work. Preserve generic errors while retaining the safe classification needed for reconnect. Never print raw exceptions, upstream responses, request bodies or cookie jars.
- Keep OAuth/storage keys stable and out of Git. No grade history or scenarios in PostgreSQL; history cache is bounded process memory. Keep the existing free hosting plans.

## Grading invariants

Missing/zero placeholders are unknown, not failing marks. Keep BM, BFS, IDAF/IDPA, module marks, certificate marks and scenarios distinct. NW counts once in the BM subject mean; its semester combination differs from the 2:1 final-exam weighting. Group raw IDAF performances before semester ERFA. Do not pool individual exams into a module mean or double-count repeated modules. Missing scheduled BM subjects prevent a complete promotion assessment. Preserve source conflicts, cohort boundaries, rounding stages, provisional labels and impossible targets above 6. Do not infer a missing assessment weight or award an official qualification.

## Checks and delivery

```sh
npm test -- --runInBand
npm run test:mcp
npm run check:privacy
git diff --check
```

MCP tests require dedicated PostgreSQL, default `postgres://postgres@127.0.0.1:55432/kaschuso_test`, or `TEST_DATABASE_URL`. They create/drop test schemas: never use production storage. Browser fixtures live in `mcp/tests/browser-server.mjs`; run frontend Playwright with `KASCHUSO_API_DIR` pointing here. Test TLS exceptions are fixture-only. See [verification record](docs/qualification-verification.md) for historical evidence; rerun checks relevant to a new change before claiming it passes.

Update runtime contracts, research/profile notes and setup docs with behaviour changes. Update `mcp/instructions.mjs` and the companion interpretation skill when tool guidance changes. A skill upload alone does not create a ChatGPT App binding: preserve an existing verified App/connection when updating it. Refresh connected clients after server metadata changes. Backend deployment precedes the paired frontend; no qualification schema migration is currently needed. Follow the task's release scope; pushing `main` triggers production deployment.
