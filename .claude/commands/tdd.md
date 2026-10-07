---
description: Run npm test and classify the result as green, expected TDD red, regression, or test bug
allowed-tools: Bash(npm test:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Read, Grep, Glob
---

Run the test suite and report the result in plain English.

## 1. Run

Run exactly `npm test` from the repo root. It is the only supported entry point (PRD §16.2) — never `npx vitest`, `vitest`, or `tsc` on its own. Read the full output, not just the exit code.

## 2. Report

**Pass, zero skipped** — reply with exactly one line and nothing else:

> All green — N tests passed.

**Pass, but some tests skipped** — per PRD §16.2, a skip is not green. Reply in one line:

> Yellow — N passed, M skipped (<suite names or missing env vars from the `[skip]` warnings>).

**Failure** — first gather just enough context to classify:
- `git status --short` and `git diff --stat HEAD` to see what changed since the last commit (untracked + modified files).
- For each failing test: read the assertion and the source of the symbol it exercises.

Then reply in **one sentence** using exactly one of these labels:

- **Expected TDD red** — the test asserts on a symbol, field, or shape that isn't built yet (missing export, unimplemented function, schema field absent, `tsc` "has no exported member" / "property does not exist" on code the test file introduced). You're on track.
- **Regression** — a test that isn't new or modified in the working tree is now failing because of a source change. Name the failing test and the likely-culprit change (file and what changed).
- **Test bug** — the test file was just edited and the test asserts something wrong (contradicts the PRD, the implemented behavior is correct, typo in the expectation, wrong import path, etc.). Name the test and what it gets wrong.

If failures span more than one category, give one sentence per category.

A `tsc --noEmit` failure stops the run before vitest — classify it with the same three labels based on which file the type error is in and whether that file is new/edited.

## 3. Stop

Do not propose a fix, do not edit files, do not suggest next steps beyond the classification. No file-by-file changelog.
