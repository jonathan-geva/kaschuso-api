# Public research: vocational grades and MCP clients

Research date: 2026-11-10. Public sources only; no student, school-account, or other account data accessed. Research notes only; no implementation.

## Follow-up: directly applicable GIBS Solothurn BM source found

**This section supersedes the provisional BM normalization inference below.** The public [GIBS Solothurn QV information for Informatiker/in, dated 30 October 2021](https://bbzsogr.so.ch/fileadmin/bbz-sogr/Berufe/Informatiker-in-EFZ/QV-Informatiker.pdf), explicitly labelled BiVo 2021, states on p.1 that BM learners' QV consists only of IPA and Informatikkompetenzen. On p.2 it says their final grade is the average of practical work and Informatikkompetenzen. That is a **school-documented 50:50 BM calculation**. It does not say to preserve/renormalize 40:30. The source directly supports omitting both ABU and eGK for this school's described BM route.

The [public BZZ Informatiker BiVo 2021 calculation sheet, July 2025](https://bzz.ch/app/uploads/2025/07/QV-Notenberechnung-Informatiker-BiVo-2021-Inkl.-BM.pdf) also explicitly gives BM IPA 50%, IK 50%, although its non-BM IPA/IK weights are 40%/30%. Thus this is not just an arithmetic interpretation of the Solothurn wording.

**Unresolved source conflict:** BBZ BL/Basel IMS and Baden IMS documents use normalized 4:3 = 57.14%/42.86%; Solothurn and BZZ use 1:1 = 50%/50%. The federal 2020 Informatiker ordinance art.19 has the ordinary 40/20/10/30 weights and no explicit BM-only formula or explicit BM-eGK dispensation paragraph. This research did not locate a federal ordinance provision that settles the contradictory special-route weighting. It would be false to call either BM formula a universally verified national law from art.19 alone. For a GIBS Solothurn-specific **forecast**, the directly applicable school-published 50:50 rule is the better local evidence; cite its date/source and preserve the uncertainty until the current competent QV authority/cohort document confirms it. Do not silently replace it with automatic normalization. A final official grade claim requires the applicable final authority's rule.

At school-documented 50:50, the conditional forecast is `T((IPA + IK)/2)`, with the separately rounded IK computed from the 80/20 BFS/üK experience-grade stages. Both IPA and IK still need at least 4. This is **not** a reason to average individual school modules and IPA directly, or include IDAF/IDPA in the EFZ vocational component.

## Applicability comes before calculation

These public notes do not establish any student's profile. Select a researched profile only from authorized contextual evidence of profession, Fachrichtung and route; do not infer it from school name, a subject label, or ICT modules alone. Lehrbeginn, applicable ordinance, dispensations, repeated modules and expected QV year still require cohort-specific evidence. The parent researcher subsequently narrowed the working scope to the directly relevant Informatiker Applikationsentwicklung/BM1 school profile; cohort start was still unresolved. No personal grades or account details are recorded here.

Use a school portal's displayed average as a displayed school figure unless its formula is known. Keep distinct: individual exam mark, weighted subject average, rounded semester certificate mark, module mark, accumulated module average, official experience grade, final QV grade, and pass conditions. Missing/not-yet-completed assessments are not zeroes. A forecast from completed work is not a final certificate grade.

## General Swiss scale and local semester rules

- [SDBB/EDK/Bund service: Noten](https://www.berufsbildung.ch/de/lexikon/noten): vocational grades range from 1 to 6, with 6 best. The profession's ordinance determines which learning locations and marks form the experience grade, their weighting, and the QV total. The experience grade is a component of the overall result, not itself a universal qualification area. The competent examination authority issues the final grade record and EFZ/EBA. **Implication:** no universal Swiss school-average-to-EFZ conversion exists.
- [Solothurn BGS 416.142, official PDF, version 1 August 2026](https://bgs.so.ch/api/de/versions/5613/pdf_file), §§1–5: applies to cantonal vocational schools; semester certificate grades use whole/half grades, 6 highest, 1 lowest, below 4 insufficient. Individual performance marks may use quarters/decimals. At least two assessed performances per subject/competence area per semester are required under the current wording. These provisions do **not** establish a universal weighting for a Kaschuso dashboard average. Historical records must use the version then applicable; do not automatically apply this 2026 version backwards.
- [Solothurn BM promotion page](https://bbzsogr.so.ch/kbs-so/abteilung-berufsmaturitaet/promotion/), quoting federal provisions: subject semester grades count for BM promotion; the IDAF semester grade does not. The promotion mean is rounded to a tenth; sufficient mean alone is not enough (also limits on deficits and number of insufficient marks). This page is KBS SO/BM guidance, **not** proof of the user's programme or a GIBS EFZ rule.

## Candidate profile: Informatiker/in EFZ under BiVo 2021

[Federal original ordinance of 19 November 2020, AS 2020, hosted by ICT-Berufsbildung Zentralschweiz](https://www.ict-bz.ch/storage/app/media/uploaded-files/Bildungsverordnung%202021.pdf), arts. 7–8, 14–15, 18–20, 25–26; official [Fedlex publication identity](https://www.fedlex.admin.ch/eli/oc/2020/941/de).

Verified standard route formula (H = rounding to a whole/half grade; T = rounding to one decimal):

```text
BFS = H(arithmetic mean of the applicable school ICT module grades)
UK  = H(arithmetic mean of the applicable üK grades)
IK  = T(0.80 * BFS + 0.20 * UK)
eGK = H(arithmetic mean of the eight eGK semester certificate grades)
QV  = T(0.40 * IPA + 0.20 * ABU + 0.10 * eGK + 0.30 * IK)
pass requires IPA >= 4 AND IK >= 4 AND QV >= 4
```

The ordinary programme has 24 school ICT modules and seven üK modules. The IPA positions are execution/result 50%, documentation 20%, presentation/discussion 30%. Do not pool all exams across modules, or average semester module means with unequal module counts. The official inputs are module grades, not all underlying exam marks. This ordinance commenced 1 January 2021; QV provisions first applied 1 January 2025. Old-law trainees/repeaters are covered by transition provisions through 31 December 2026. These standard formulas alone do not resolve dispensation/repetition cases.

### Execution-rule editions and practical work

- [ICT national QV execution rules issued 20 June 2024](https://www.ict-berufsbildung.ch/resources/Informatiker-EFZ_Ausfuehrungsbestimmungen_QV_202406121.pdf), pp.4–6: confirms 40/20/10/30 overall weights, 80/20 ICT aggregation and internal IPA 50/20/30. Grade positions use half/whole marks; QV totals use tenths. The [current download centre](https://www.ict-berufsbildung.ch/services/download-center) now labels this file as **up to 2026**.
- [ICT national updated execution rules issued 1 April 2026](https://www.ict-berufsbildung.ch/resources/Informatiker-EFZ_Ausfuehrungsbestimmungen_QV_de.pdf), pp.4–6,14: same listed grading weights. The download centre labels this edition **from 2027**, while its own commencement text says 1 April 2026. Record both the edition and the QV year; do not collapse the two dates into a claim that every 2026 exam used the new procedure. The revision changes procedural/assessment details, even where the aggregate weights remain the same.
- [ICT QV overview](https://www.ict-berufsbildung.ch/grundbildung/fuer-lernende/qualifikationsverfahren): Informatiker/in uses IPA; ICT-Fachfrau/-mann uses VPA. VPA has nationally specified work packages; IPA's task comes from the training/internship employer under national rules. The canton of the apprenticeship contract is responsible. **Do not present IPA and VPA as interchangeable options selected by a grade calculator.**

## Candidate older profile: Informatiker/in EFZ BiVo 2014

[SBFI ordinance of 1 November 2013 hosted by the national OdA](https://www.ict-berufsbildung.ch/resources/Bildungsverordnung_Informatik-EFZ_BiVo-2014_DE1.pdf), arts.20–22, and [national 2014 QV execution rules](https://www.ict-berufsbildung.ch/resources/Ausfuehrungsbestimmungen_QV_Abschlusspruefung_Informatik-EFZ_BiVo-2014_DE.pdf), pp.4–5,9–10.

```text
IK  = T(0.80 * H(mean of school ICT module grades)
       + 0.20 * H(mean of üK grades))
eGK = H(mean of eight eGK semester certificate grades)
QV  = T(0.30 * IPA + 0.20 * eGK + 0.30 * IK + 0.20 * ABU)
pass requires IPA >= 4 AND IK >= 4 AND QV >= 4
```

The internal IPA positions are result 50%, documentation 25%, discussion/presentation 25%, unlike BiVo 2021. The national [superseded ordinances page](https://www.ict-berufsbildung.ch/grundbildung/ict-lehren/auslaufende-bildungsverordnungen) directs Informatiker/in trainees starting before 2021 to the older rules; the formal transition has deadlines and repeat-exam exceptions. Earlier-than-2014 cohorts were not researched. Betriebsinformatiker/in EFZ under its separate 2021 ordinance is a separate profile; do not reuse this profession ID or assume identical weights.

## BM, ABU, IDAF and IDPA

### Why BM IDAF is not generally an EFZ vocational component

[SBFI BM overview](https://www.sbfi.admin.ch/de/berufsmaturitaet): BM combines EFZ vocational qualification with extended general education, producing two qualifications. Interdisciplinary work is part of the BM curriculum. Its existence does not make it an ICT module or an EFZ professional-knowledge component.

[BMS Zürich official school reproduction of BMV 13 June 2025](https://www.bms-zuerich.ch/ausbildung/unterricht/berufsmaturitaetspruefung), art.23: the BM interdisciplinary final mark combines 50% IDPA and 50% IDAF experience grade, rounded to a whole/half mark. In the new rules the IDAF experience grade is normally the semester-mark mean rounded to a tenth; two-semester programmes use the performance-mark mean rounded to a whole/half mark. These are **BM** calculations. IDAF is not listed in either researched Informatiker EFZ QV formula. Therefore do not add it to the EFZ professional/module mean or equate it with ABU, IPA, üK, or eGK.

[SBFI official explanatory report for BMV 2026](https://www.sbfi.admin.ch/dam/de/sd-web/-HFoeE-AlOJR/04_de_Erl%C3%A4uterungen_bereinigt.pdf), pp.11,14,18–19: IDAF prepares for IDPA; IDPA refers to at least two BM subjects and working life. The report explicitly distinguishes semester promotion (IDAF/IDPA do not count) from final BM assessment, and says a failed BM can still result in EFZ when EFZ requirements are met. It documents changed rounding rules. [SBFI dates](https://www.sbfi.admin.ch/de/berufsmaturitaet): old BMV until 28 February 2026, new BMV from 1 March 2026. Cohort transition is material; do not apply new experience-grade rounding to all current learners without checking their BM start/rules.

### Existing ABU regime: 2006 ordinance

[SBFI ordinance 27 April 2006, consolidated 4 March 2014, hosted by public BZZ](https://bzz.ch/app/uploads/2024/11/Verordnung-des-SBFI-ueber-Mindestvorschriften-fuer-die-Allgemeinbildung-in-der-beruflichen-Grundbildung.pdf), arts.7–12,14:

For standard three-/four-year programmes, ABU final = T(mean of ABU experience grade, Vertiefungsarbeit, final exam). Under art.12(3), attending BM through its final exams gives ABU dispensation, shown in the grade record. In a **late transfer out of BM**, art.12(2) allows the IDPA mark to substitute for the ABU Vertiefungsarbeit; absent that mark, the ABU final is the exam mark and no experience grade is awarded. Earlier transfer follows another rule. This narrow IDPA substitution is **not** a general IDAF-to-EFZ rule. Second vocational qualifications/equivalent general-education credentials have separate dispensations.

### New ABU regime and transition

[Solothurn official March 2026 ABU regulation amendment](https://bgs.so.ch/api/de/change_documents/file_dictionaries/1689/pdf_file), in force 1 August 2026, §§6–9,17bis,22: replaces VA terminology with Schlussarbeit; standard three-/four-year final remains the mean of experience, Schlussarbeit, and exam rounded to a tenth. It provides a two-component rule after transfer in the penultimate semester, and ABU exemption for BM attendance through the penultimate semester. It expressly points to federal art.17 for cohort transition.

The [federal current legal identity](https://www.fedlex.admin.ch/eli/cc/2025/263/de?version=20260101) is the 9 April 2025 ordinance effective 1 January 2026. The web reader could not render Fedlex's JavaScript text. A [nonofficial transcription](https://ch.odat.ch/de/cc/412.101.241-20260101-de.html), arts.14,17–18, corroborates the cantonal text and says pre-2026 starters retain old law, with special shortened-programme/repetition deadlines. This transcription is a research aid, **not a substitute for the official publication**; full federal transition should be rechecked in the official text before encoding it. Do not silently apply the new BM exit rule or Schlussarbeit rules to older cohorts.

### Conditional BM EFZ weighting example and source conflict

[Public BBZ Baselland Informatiker EFZ BiVo 2021 guide, May 2021](https://www.bbzbl.ch/wp-content/uploads/2021/07/Qualifikationsverfahren-QV-BiVo-2021.pdf), p.1, states that for its BM learners eGK and ABU drop out, leaving IPA 57.14% and IK 42.86%, i.e. normalized 40:30. **Conditional example only:** use the exact ratio `(40*IPA + 30*IK)/70`, not rounded percentage coefficients, when both dispensations are actually applicable. This does not establish the user's dispensation, nor a universal rule for all professions, BM routes, withdrawal dates, or cohorts.

Caution: the **same school sheet** labels itself BiVo 2021 but displays the old internal IPA weights 50/25/25. The original 2020 federal ordinance and current national ICT rules instead give 50/20/30. Do not copy the school graphic wholesale as the legal authority. The follow-up above found directly applicable GIBS Solothurn information stating that its described BM route uses only IPA and IK, and a 50:50 mean; this conflicts with the BBZ BL normalization example. ABU and eGK dispensations must still be stored/confirmed separately for withdrawal/special cases; BM 2 after apprenticeship is not automatically an exemption during an earlier EFZ.

## Calculation/recommendation boundaries

- An incomplete BFS module list gives a provisional observed mean, not the final official experience grade. Show completed/expected counts and keep the rounded official stage separate from the unrounded descriptive mean.
- Repetitions have explicit special rules in each BiVo; do not count both attempts or replace grades arbitrarily. This research verified the existence of special module/üK repeat provisions, but did not fully map all repeat/adult/validation pathways.
- An individual insufficient module is not identical to failing the final QV. Conversely QV mean >=4 alone does not satisfy the two researched Informatiker profiles' IPA/IK minimums.
- A BM displayed mean, a promotion mean, an EFZ module mean and a final BM total can legitimately differ. IDAF may be visible without counting for semester promotion; it still participates in BM final interdisciplinary assessment.
- Sport, elective courses, exemptions, unconfirmed marks and zero-weight assessments need explicit handling from the actual data/rules. No generic official Kaschuso dashboard formula was verified here.
- Threshold/rounding ties need the applicable school/QV rounding convention; the sources prescribe precision but this research did not establish a universal tie-breaking algorithm or permission to round at arbitrary intermediate stages.

## Brief public MCP OAuth compatibility research

These are current public documentation patterns, not tested account integrations. Client edition, plan/workspace policy and version matter. An MCP endpoint URL is common infrastructure, but each client normally gets its own connection and user authorization. Do not promise that one client's existing school session/cookies or OAuth grant automatically carries to another client.

| Client/surface | Verified public pattern | Official source and boundaries |
|---|---|---|
| ChatGPT web | Current Plugins UI: add custom MCP server; supply public HTTPS endpoint (or available Secure MCP Tunnel), configure OAuth and inspect discovered tools. Current help says Developer Mode need not be enabled first. Business/Enterprise/Edu roles and workspace policy govern custom connections. | [OpenAI help](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). Do not copy old Settings/Connectors/Developer Mode instructions as universal current UI. |
| ChatGPT server OAuth | Protected-resource metadata + authorization-server discovery; authorization code with S256 PKCE; resource/audience binding; client identity via CIMD, DCR, or predefined registration. Copy the exact redirect URI from server management; stable and callback-specific modes coexist. | [OpenAI official authentication documentation](https://developers.openai.com/plugins/build/auth). Server verifies issuer/audience/expiry/scopes on every call. Avoid hard-coding one remembered ChatGPT callback for all connections. |
| Claude remote connector | Customize → Connectors → Add custom connector; URL; detected authentication; published Claude identity, automatic registration, or own OAuth client. Users connect individually. Remote connector traffic originates in Anthropic cloud, including Desktop/Cowork; local Desktop stdio configuration is a different mechanism. | [Claude official setup help](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). Reachability from a user's laptop alone does not establish cloud reachability. |
| GitHub Copilot Chat IDE | Configure a remote server in IDE MCP configuration, then use the Auth action for an OAuth server. `mcp.json` examples use a remote URL; scoped user consent and organization policies apply. | [GitHub official IDE documentation](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/extend-copilot-chat-with-mcp?tool=vscode). Copilot product/surface must be named; this does not prove M365 Copilot or every Copilot cloud agent accepts the same setup. |
| Gemini CLI | `mcpServers` in settings; `httpUrl` selects Streamable HTTP, `url` selects SSE. Remote OAuth support; `/mcp auth` lists/authenticates servers and `/mcp auth serverName` starts/repeats sign-in. | [Google Gemini CLI official docs](https://geminicli.com/docs/tools/mcp-server/). This verifies **Gemini CLI**, not arbitrary remote MCP support in consumer Gemini web/mobile. |

[GitHub official cloud-agent configuration documentation](https://docs.github.com/en/enterprise-cloud%40latest/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers) explicitly says repository/custom-agent MCP configuration for Copilot cloud agent and code review currently does not support remote OAuth servers. Therefore describe support per client surface; a statement that all Copilot products share the IDE OAuth flow would be unsupported.

Practical cross-client architecture inference: use a standards-conforming remote HTTP MCP server with per-user OAuth, discoverable authorization metadata and a consented read scope; document registration and connection steps separately per supported client. Verify clients against a test account and test fixture data before claiming interoperability. This research did not create OAuth clients, authenticate to providers, access school systems, test refresh tokens, or verify any live end-to-end connection.
