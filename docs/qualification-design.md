# Qualification planner design

Status: implementation authorised end to end. Scope: GIBS Solothurn Informatiker/in EFZ, Applikationsentwicklung, BiVo 2021, with eight-semester BM1 TALS under the pre-2026 cohort rules. Research date: 2026-11-10.

## Approach

Keep the existing backend and frontend repositories. A pure backend rules engine serves the REST planner and MCP tools. A third shared-package repository would introduce release coordination without helping this first supported profile. Community additions will be versioned, source-cited profile files with fixture tests; no other apprenticeship is implemented now.

## Privacy

No private worksheet, credentials, school HTML, real grades, identity, teacher/class identifiers or account-specific examples enter either repository, fixtures, documentation, screenshots or plugin files. Live inspection uses a private temporary capture outside Git, whitelisted diagnostics and no debug dumps. Delete temporary captures after verification. Use synthetic browser fixtures. Read-only school operations only; historical selection must restore the original upstream semester even on failure. Retain OAuth account isolation and existing revocation/credential handling.

## Data and history contract

`getGradeHistory(mandator, username, password, options = {})` is an account-serialised service. Default: at most eight most recent non-future portal semester options. `options.semesterIds` optionally chooses 1–8 IDs from the portal-provided allowlist. Never accept upstream URLs. A semester selector is a global catalogue, not evidence of student enrollment. No records is an empty semester, not zero grades or an assumed qualification start. Preserve selected semester in `finally`; bounded timeouts and safe generic errors. An in-memory account-isolated history cache of 60 seconds is cleared by account disconnect. No disk persistence.

REST `GET /api/grade-history?semesters=<comma-separated ids>` returns:

```
{ availableSemesters: [{id,label,isCurrent}], selectedSemester: {id,label},
  semesters: [{id,label,isCurrent,subjects:[{name,average,grades:[{date,name,value,weighting,points,average}]}]}],
  complete: boolean, issues: [string] }
```

Exclude source `class`, student identity and upstream navigation tokens. Unsupported portal markup fails safely; never silently show current grades under another semester label. Validate selected semester after every fetch, reject future IDs for history and restore using fresh trusted page metadata when necessary. History reads must not contaminate existing current-grade calls.

## Rules engine contract

CommonJS `qualification/index.js` exports `buildQualification(history, scenario = {})`, `validateScenario(input)` and `getRules()`. No I/O or student identity. Only finite grades 1–6; missing/zero/unparseable values are null. Stable subject mapping recognises known German BM names, `M<number>` ICT modules, IDAF/IDPA and explicit unknowns. Unknown subjects are not guessed into averages.

Scenario inputs: `{startYear?, semesterOverrides?:{[semesterId]:{[subjectKey]:number}}, targets?:{[subjectKey]:number}, examGrades?:{[subjectKey]:number}, ukGrades?:number[], ipaGrade?:number, confirmedCertificateGrades?:boolean}`. Limit arrays/maps and reject unknown keys, malformed years and non-finite/out-of-scale numbers. Overrides are explicit user inputs with provenance, never overwrite portal marks. Source averages are provisional; rounded live portal averages are not official certificate grades. `examComponents` accepts paired written/oral marks for Deutsch/Englisch; `idafGroups` explicitly groups performances into two semester marks; `moduleSelections` resolves conflicting module attempts. History and qualification responses retain the source `retrievedAt` timestamp; `interdisciplinaryInputs` exposes provisional observed performances without treating them as semester marks. `startYear` is editable and defaults only from the earliest nonempty retrieved school year, with an inferred label. Do not hard-code a student's start year.

Output (JSON):

```
{profile:{id,name,version,scope}, semesterSummaries:[{id,label,bmAverage,bfsAverage,bmCount,bfsCount,excludedCount,provisional}],
 bm:{subjects:[{key,label,semesterGrades:[{semester,semesterId,value,source}],experienceGrade,examGrade,finalGrade,target,requiredFutureAverage,missingCount,explanation}],
     overallAverage,insufficientCount,deficitPoints,status,issues},
 efz:{modules:[{key,label,semesterId,grade,source}],bfsModuleAverage,bfsRoundedGrade,ukAverage,ukRoundedGrade,informaticsGrade,ipaGrade,overallAverage,status,issues,weighting},
 sources:[{id,title,url}],issues:[string],retrievedAt }
```

Calculations use decimal-safe half-up rounding and expose intermediate rounding stages. Plain BM/BFS semester means are descriptive arithmetic means of subject/module averages, not pooled exam means or official QV results. Exclude IDAF/IDPA and unknowns from those two means; show interdisciplinary work separately. Distinguish BM semester-promotion checks (mean >=4, at most two insufficient, deficit <=2; IDAF excluded) from final BM conditions and required EFZ.

The pre-2026 Solothurn timetable: Deutsch1–8, Französisch1–6, Englisch1–8, Mathematik Grundlagen1–4, Mathematik Schwerpunkt5–8, Physik3–8, Chemie5–8, Geschichte/Politik1–4, Wirtschaft/Recht3–8. NW semester mark uses Physik alone before chemistry, then the mean of Physik/Chemie; missing a required component remains incomplete. NW final exam uses Physik:Chemie2:1 (tenths inputs). Eight ordinary subjects plus interdisciplinary work form nine equally weighted final BM subjects. Experience, combined exam and final subject grades round to halves; overall to a tenth. Exam-bearing subjects combine ERFA/exam50:50; non-exam GP/WR use ERFA. Language certificate exemption variants are not auto-assumed: first implementation uses ordinary exams and describes certificates as requiring manual confirmed exemption/support later. IDAF must group performance results into semester marks before ERFA, and IDA combines IDAF/IDPA50:50; absent/grouping-uncertain values produce incomplete results. Never equate four raw IDAF marks with four semester certificate marks. Final pass requires complete official inputs plus EFZ, mean>=4, <=2 insufficient and deficit<=2; otherwise show provisional/on-track/incomplete, never award a diploma.

Targets are planning inputs, not grades. Show required average over missing eligible semester slots and an optional final-exam target; values >6 are impossible, <=1 already reachable at minimum, missing weights unsupported. Use an interval/half-grade search where rounding changes the threshold. A target does not uniquely determine all future marks: describe the equal-future-mark assumption. Do not silently assume an exam weight of one. Existing next-exam projection remains explicit about supplied weight.

ICT aggregation: half-rounded mean of distinct school module grades (avoid double counting a module repeated across history; ambiguous conflicting attempts require confirmation), half-rounded mean of seven supplied üK grades, then80:20 rounded to a tenth. Module grades from running averages remain provisional. Do not count all individual tests as modules. Local GIBS BiVo2021 BM school document specifies final EFZ mean(IPA,IK),50:50, with ABU/eGK exempt. Public sources conflict with other schools'4:3 derivation: cite the local profile and flag confirmation required before an official result. Never mix IDAF into ICT modules. Missing üK/IPA values stay missing and can be entered as explicit scenario values if the portal lacks them.

## REST and MCP integration

`GET /api/qualification` returns `buildQualification(await getGradeHistory(...))`. `POST /api/qualification` accepts the validated scenario only and computes against fresh/cached authorised history. Same auth, credential-query rejection, no-store, limits and generic errors as existing routes. `GET /api/qualification/rules` may expose only public rules and sources without account data. Never accept credentials in scenario bodies.

MCP adds `get_grade_history`, `get_qualification_overview`, `calculate_qualification_scenario`. Their identity comes solely from OAuth. Existing tools remain compatible. New results must recheck revocation after upstream work. Supply common server instructions at MCP initialization, plus structured provenance, source/profile identity and incompleteness. The companion skill explains the Swiss scale (6 best,4 pass), BM/BFS/IDAF distinctions, official vs provisional values, rounding and target assumptions. Client tools that support standard authenticated streamable HTTP can connect; document limitations, rather than claim every chatbot supports MCP. ChatGPT web is the live priority; other client paths receive protocol/fixture coverage only.

## Frontend

Retain current grades/absences and styling. Add a semester picker/history view; two separate BM/BFS average cards; a Qualification/Planner tab with BM semester table (responsive horizontal scroll), ERFA/exam/final columns, target inputs and required-future-grade cells. Highlight observed/imported values, user overrides, missing values and forecasts with text labels as well as colour. Show completion counts, data-refresh time and compact source/rule explanations. A separate EFZ panel shows BFS modules →80%, üK→20%, combined IK → local50% plus IPA50%, with missing üK/IPA inputs and the documented-source conflict note. No zeros for blanks or misleading pass badges.

A discreet Chatbot link opens setup help for ChatGPT, Claude and other MCP clients. Provide copyable canonical endpoint, OAuth details, Markdown instructions and a copy-prompt button. Explain that users must approve school sign-in themselves; a Markdown file cannot install a connection or grant credentials. No pop-ups, repeated banners, password-bearing links or analytics of grade data. Prefer in-memory scenarios initially; no grades/credentials in localStorage or service-worker cache. User-selected non-sensitive display preferences can persist separately.

## Verification and delivery

Meaningful synthetic tests cover history allowlist/restore/failure/serialization/cross-account isolation, missing values, half-rounding boundaries, separate averages, NW weighting, IDAF grouping, distinct-module handling, completeness and target feasibility. Frontend lint/build and responsive browser tests must pass. Run privacy scans plus exact private-value search with matches never printed. Live test only the approved account, no screenshots/traces, compare counts and source-semester consistency. Review changes before PRs. Document source conflicts, supported cohorts, calculator formula stages, API/MCP setup, extension contribution requirements, and operational rollout. Preserve free Render/Neon plans; no new services or paid storage.
