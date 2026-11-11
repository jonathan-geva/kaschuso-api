# Add a qualification profile

The first profile is deliberately narrow: GIBS Solothurn, Informatiker/in EFZ Applikationsentwicklung, BiVo2021, eight-semester BM1 TALS for BM starts before2026/27. Other programmes should add profiles rather than loosen this profile's rules or copy its weights.

1. Open an issue/PR identifying the profession, specialisation, school, route, start-year range and applicable qualification year. Use public facts, never a student's class or account.
2. Cite primary sources with exact editions, effective dates, transition provisions and relevant article/page numbers. A document's publication date alone does not determine cohort applicability. Document conflicting sources and unresolved school-specific interpretations.
3. Add a versioned profile under `qualification/profiles/` containing subject mappings, eligible semesters, experience/exam/final weights, precision at every stage, expected component counts and source links. Keep calculations deterministic and independent of HTTP, OAuth and student identity.
4. Add fully synthetic fixtures and expected calculations: complete example, incomplete data, rounding boundary, missing weight/component, impossible target, repeated module and an unsupported cohort. Never commit a filled private worksheet or copied school HTML.
5. Document how official certificate marks differ from running averages, how subjects are classified, which exemptions require confirmation and where manual scenario inputs remain necessary.
6. Update the public rules/schema, frontend profile presentation and MCP instructions together; preserve backwards-compatible current-grade tools. Run backend unit/MCP/security tests and frontend lint/build/browser checks.

Do not infer a new profession from a module number alone. Reviewers should require evidence for all formula stages and test why a tempting alternative produces the wrong result. Future contributions can add new profiles without creating another repository or granting more access to students' records.

## Developer verification

Use Node24 and a dedicated local PostgreSQL database for MCP fixtures. Never use production storage for tests.

```sh
npm test -- --runInBand
npm run test:mcp
npm run check:privacy
```

In the dashboard checkout run `npm run lint`, `npm run build`, and `KASCHUSO_API_DIR=/absolute/backend/path npm run test:e2e`. Browser tests and screenshots use synthetic records only. Live investigation must suppress credentials, source HTML, navigation tokens and identity in diagnostic output; remove private captures afterwards.

No schema migration is needed for the initial planner: history cache and scenarios stay in memory; the existing OAuth credential store remains unchanged. Deploy the backend and frontend changes together, then refresh connected MCP clients to discover the new tools and initialization instructions. Keep the existing free hosting plans and stable OAuth/storage keys.
