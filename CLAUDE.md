# CLAUDE.md

You're helping build the **AI Sales Prospecting Agent** — a console agent that researches a company by name, scores it as a sales prospect, persists results to Airtable, and drafts personalized outreach.

This file is **working agreements** — rules that fire every prompt. The full spec lives in `PRD.md` and is the source of truth. If a request contradicts the PRD, ask before deviating.

## PRD jump table

| Topic | PRD section |
|---|---|
| Dependencies & version pins | §4.2 |
| Prospect / Outreach Zod schemas | §7, §11.1 |
| Lead score rubric & buying signals | §8, §9 |
| Memory model | §10 |
| Tool surface & loop boundary | §12 |
| Airtable table schemas | §13.2, §13.3 |
| Error handling matrix | §15 |
| Required test coverage | §16.1 |
| Test execution contract | §16.2 |
| Test is the spec for the change | §16.3 |
| Acceptance criteria | §17 |

## Installs

Never run `npm install <pkg>` without a version range — defaults silently bump pinned majors. Consult PRD §4.2 before adding any dependency.

## PRD vs code disagreements — PRD wins on names

When PRD spec and existing code disagree on a name (helper, table, field, symbol), the PRD wins. Don't silently follow the code to "avoid mid-feature renames" — surface the drift, then either fix the code to match the PRD or update the PRD if the code is correct. Resolve in place; don't paper over.

## TDD with real services
<!-- Testing philosophy: real Tavily, real Airtable, no mocks. Failing test first, green before moving on. -->

Write the failing test first, implement to green, refactor. Tests hit real Tavily, real Airtable MCP, real `preferences.md` — no mocks. Run `/tdd` after every meaningful change: green → suggest a commit, red → fix before moving on. The full test contract (skip visibility, missing-env handling, cleanup, "test is the spec") lives in PRD §16.

Before claiming a TDD cycle green, re-read the PRD sections that govern the files you touched (jump table above). Drift that survives `/tdd` is drift that survives forever.

## Red test → fix the code, not the test

When a test fails, change the implementation until it passes — never weaken, loosen, or rewrite the assertion to get green. The test that goes red → green is the spec for that change (PRD §16.3). If an assertion itself looks wrong, stop and surface it; fix it deliberately in its own change, never silently mid-cycle.

## TDD report style — terse by default

When the result matches what TDD predicts, say so in one sentence and stop:
- Red as expected: "Tests fail as expected — <one-clause reason>."
- Green as expected: "Tests pass as expected."

Explain only when the result is NOT what TDD predicts (red when green was expected, green when red was expected, or a load-time/compile error instead of a normal assertion failure). Then say what's off.

If you touched a file outside the one under test, name it in one line so scope creep is visible. No file-by-file changelog, no "and here's why I added X" recap — the user reads the diff.

## Reading §16.1 stage tags

Skip conditions reflect what the test currently requires to run, not the stage it was introduced in. When a later stage adds a new env dependency to a function tested by earlier-stage bullets, update those earlier bullets' skip conditions too — the stage tag is provenance, not a floor.

## Cross-stage test prevention

When implementing tests from a PRD spec block that spans multiple build stages, only implement tests whose dependencies already exist in the codebase. If a test asserts on a field, function, or behavior that comes from a later stage, skip it and surface — don't write a test that's guaranteed to fail because the upstream code doesn't exist yet. Prompts that name "every bullet" of a §16.1 section are a smell: they collapse staging into one shot. Reference the stage tag (`(searchWeb build)`, `(structurer + persistence)`, `(preferences wiring)`, etc.) so the implementation cannot pull future-stage behavior forward.

## Pause and confirm before
<!-- The guardrails — actions Claude must stop and ask about before taking. -->

- Destructive shell commands (`rm -rf`, `git reset --hard`, `git push --force`, deleting non-test Airtable rows).
- Editing the PRD or the system prompts at `src/agent/prompts/*.md` — these are load-bearing.
- Adding a new dependency, **or bumping the major version of an existing one** (e.g. `ai@5` → `ai@6`, `vitest@3` → `vitest@4`). Major bumps are PRD changes, not implementation choices.
- Editing version ranges in `package.json` for any reason. The pins map to the API surface the codebase and prompts are written against.
- Refactoring mid-feature — finish the feature first.

Default to small, reversible changes. One-time permission ≠ blanket authorization.

## Commits & secrets

- Commit after every green test cycle. Small commits beat big ones. Messages explain *why*, not what.
- `.env` is in `.gitignore`. Never `git add` it. If `.env` shows up in `git status`, stop and check `.gitignore` before doing anything else.
- Never `git add -A` blindly when there are untracked files.
- API keys never appear in code, commit messages, terminal output, or test output. If the user pastes a secret in chat, treat it as compromised and tell them to rotate.

## When you're stuck

1. Re-read the relevant PRD section (jump table above).
2. Run `/tdd`. The failure message often tells you what's wrong.
3. Re-run the failing command and read the streaming `[brain]` / `[tool]` / `[code]` lines — they show what the agent actually decided.
4. Ask before structural changes (new folders, dependencies, schema changes).

## Evolving this file

When you discover a working agreement that should fire every prompt, propose adding it here — not the PRD. When you discover a spec change (schema, error matrix, test requirement), propose adding it to the PRD — not here. Keep this file under ~80 lines.
