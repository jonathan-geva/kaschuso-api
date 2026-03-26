---
name: sensitive-data-review
description: "Use when reviewing code, tests, fixtures, docs, or commits for sensitive data exposure: names, phone numbers, emails, usernames, passwords, tokens, API keys, private IDs, birth dates, postal codes (PLZ/ZIP), hometown/Heimatort, or school-specific class/course identifiers."
argument-hint: "Target paths and output mode (quick or thorough)"
---

# Sensitive Data Review

## Outcome
Prevent accidental publication of secrets and personal information in a public repository by running a repeatable scan, triaging findings, and verifying safe replacements.

## When To Use
- Before commit, push, release, or PR review.
- After adding fixtures, logs, traces, screenshots, or copied upstream payloads.
- When modifying auth, env vars, request logging, or docs.

## Inputs
- Target scope: `repo`, `staged`, or a folder path.
- Mode: `quick` or `thorough`.

## Procedure
1. Set scan scope.
- `repo`: whole repository.
- `staged`: only staged changes via `git diff --cached`.
- path: specific directory.

2. Run secret-pattern scan.
- Search for likely credentials and tokens:
```bash
rg -n -i "(api[_-]?key|secret|token|password|passwd|authorization: bearer|x-api-key|private[_-]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,})" <scope>
```

3. Run personal-data scan.
- Search for direct identifiers and contact data:
```bash
rg -n -i "([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?[0-9][0-9\-() ]{7,}[0-9]|(first|last)?name\s*[:=]|address\s*[:=]|student[_ -]?id|teacher|guardian|birth(date)?|geburtsdatum|username\s*[:=]|zip(city)?\s*[:=]|postal|plz|heimatort|hometown)" <scope>
```

4. Run school-domain specificity scan.
- Search for non-generic class/course tokens and institution-specific labels:
```bash
rg -n -i "(class\s+[0-9A-Za-z-]+|course\s+[0-9A-Za-z-]+|mandator|school|portal|resource_list|real user|real student|real teacher)" <scope>
```

5. Triage each finding.
- `True positive secret`: remove and rotate where required.
- `True positive personal data`: replace with generic placeholders.
- `Domain-specific but non-sensitive`: keep only if required; otherwise genericize.
- `False positive`: keep and record why.

Personal data includes direct identifiers and quasi-identifiers that can identify a person in context, including date of birth, postal code, city, and hometown.

Treat the following as sensitive by default, including in test fixtures: `PLZ/ZIP`, `Geburtsdatum/birth date`, and `Heimatort/hometown`.
Only keep them when values are fully synthetic placeholders.

6. Apply safe replacements.
- Use placeholders like `STUDENT_NAME`, `TEACHER_NAME`, `COURSE_TOKEN`, `example@example.com`, `000-000-0000`.
- For location/date fields, use placeholders like `0000 Placeholder City`, `01.01.2000`, `Placeholder Hometown`.
- Keep format shape intact for parser tests.
- Do not weaken test coverage while sanitizing fixtures.

7. Verify and re-scan.
- Re-run all scans to ensure no sensitive matches remain.
- Check `git diff` to confirm replacements are complete and readable.

## Decision Points
- If a value can grant access, treat it as secret even if short-lived.
- If data can identify a real person in context, sanitize it.
- If uncertain whether data is sensitive, escalate and do not publish unchanged.

## Completion Checks
- No high-confidence secret matches in current scope.
- No real personal identifiers remain in changed files.
- Fixtures and docs use generic placeholders.
- Any accepted false positives are explicitly justified in review notes.

## Quick Mode
1. Run secret-pattern scan on staged files.
2. Sanitize true positives.
3. Re-scan staged files.

## Thorough Mode
1. Run all three scans on the full repository.
2. Review test fixtures, docs, and scripts manually for context leaks.
3. Re-scan and confirm completion checks.
