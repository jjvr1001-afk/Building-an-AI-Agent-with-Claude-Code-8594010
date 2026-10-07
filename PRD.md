# AI Sales Prospecting Agent — Product Requirements Document

## 1. Overview
<!-- What we're building, who it's for, and the techstack at a glance. -->

A console-based AI agent that researches a company, scores it as a sales prospect, persists the result to Airtable, and drafts a personalized outreach email. The agent is built on Claude as the Brain, Tavily for web search, Airtable for the prospect pipeline, and a local Markdown file for user-preference memory.

The agent is for **a single sales rep** working from the terminal. It runs as a one-shot CLI: type a company name, watch the agent research, see the result land in Airtable. Tell it your preferences ("for shipping companies, lead with multilingual deflection") and the next run shapes its analysis to match.

**Who the agent works for** — a company that sells AI-powered customer support tools (full product description in §1.1). This is the lens the agent scores through and the position the agent pitches from; without it, the agent has no way to judge whether a prospect is a fit. The system prompts at `src/agent/prompts/brain.md` and `src/agent/prompts/outreach.md` both carry this context to the agent at runtime.

**Tech stack:** TypeScript (Node 22+) · Vercel AI SDK v5 · Claude (Anthropic) — `generateText` + `generateObject` · Tavily REST (hand-wrapped) · Airtable hosted MCP · local Markdown file for preference memory · Zod · Vitest · GitHub Codespaces. Pinned versions, full dependency contract, and "Do NOT install" list are in §4.2.

### 1.1 Vendor context

The agent works for a vendor that sells **AI-powered customer support tooling** — agents and automation that handle support tickets, email, and chat at scale. This identity is the lens the agent scores through (research) and the position it pitches from (outreach), and it must be referenced consistently across all system prompts.

**Canonical product description** — use this language verbatim in any prompt that names what the vendor sells. Paraphrasing causes research and outreach to disagree about the vendor's offering.

- **Tier-1 deflection** — automating high-volume routine queries before they reach a human agent.
- **Multilingual triage** — handling inbound across languages without dedicated multilingual headcount.
- **24/7 response** — coverage outside business hours, anywhere in the customer's geography.
- **Knowledge-base assist** — retrieval-augmented agent answers grounded in the customer's own product docs.

System prompts at `src/agent/prompts/brain.md` and `src/agent/prompts/outreach.md` must both anchor on this description.

### 1.2 Repo layout

Four folders that map directly to the four-component framework (Brain, Tools, Memory, Loop — detailed in §4): `agent/` is the Brain, `tools/` is the search-tool surface and the Airtable MCP helper, `memory/` holds the preference store plus the three `tool()`-wrapped helpers the Brain uses to read and edit it, and `tests/` mirrors `src/`.

```
.
├── PRD.md                            # this document
├── README.md
├── package.json                      # one script: "test" — tsc --noEmit then vitest with .env loaded; see §16.2
├── package-lock.json                 # committed; reproducible installs
├── tsconfig.json                     # type-check only (noEmit); see §4.3 for exact contents
├── vitest.config.ts                  # per-test timeout (60s); see §16.2
├── .env.example                      # committed; placeholders only
├── .gitignore                        # ignores .env
├── .claude/
│   └── commands/
│       └── tdd.md                    # /tdd slash command — runs vitest, summarizes failures
├── src/
│   ├── agent/                        # the Brain
│   │   ├── research.ts               # researchCompany + structureProspect + ProspectSchema
│   │   ├── outreach.ts               # draftOutreach + OutreachSchema
│   │   └── prompts/
│   │       ├── brain.md              # system prompt for the research loop
│   │       └── outreach.md           # system prompt for draftOutreach
│   ├── tools/                        # the Brain's loop-side tool surface
│   │   ├── tavily.ts                 # searchWeb tool() — Tavily wrapper, blocklist inline
│   │   └── airtable.ts               # getAirtableMcp() — MCP client lifecycle helper (used by code, not exposed to the Brain)
│   └── memory/                       # user-preferences store + the brain's preference tools
│       └── preferences.ts            # listPreferences / addPreference / removePreference — each wrapped with tool() and exposed to the brain
└── tests/                            # mirror of src/, one .test.ts per source module — files created per-feature in TDD, never pre-scaffolded. See §16.1 for the v1 end-state list.
```

**Naming and placement conventions** (load-bearing — follow when scaffolding):

- **One folder per component.** `agent/`, `tools/`, `memory/` map straight to the four-component teaching frame in §4. The Loop has no folder of its own — it's run by the SDK and configured inside `agent/research.ts`.
- **Files in `src/` are named for what they own** — the verb they export (`research.ts` → `researchCompany`) or the resource they wrap (`tavily.ts`, `airtable.ts`). **No `index.ts` barrels.**
- **`src/memory/` is the preferences store and the tools that read and edit it.** `src/memory/preferences.ts` exports three helpers — `listPreferences`, `addPreference`, `removePreference` — each wrapped with `tool()` and exposed to the Brain inside the loop, alongside `searchWeb`. The Brain decides when to call them. See §10 for the memory model and §12.1 for why these tools live inside the loop.
- **Schemas live with their producers, not in a central `types.ts`.** `ProspectSchema` lives in `research.ts` (where prospects are produced and validated); `OutreachSchema` lives in `outreach.ts`. Colocating schema and the code that emits it keeps the spec next to its consumer.
- **Tests live under `tests/`**, one file per source module, named to match (`research.ts` ↔ `tests/research.test.ts`). **Each test file is created at the start of its feature's TDD step, not pre-scaffolded.** The v1 end-state list lives in §16.1 next to each feature's test spec — not in the layout above — because filenames are spec (what each file asserts), not structure (what files exist). `tests/` starts empty (or doesn't exist yet) and grows one file at a time as each TDD cycle begins. Empty `.test.ts` placeholders fail vitest collection (`Error: No test suite found in file`) and pollute the output of every later run until that feature lands; the scaffolder must not pre-create them. Run via the `/tdd` slash command. `tsconfig.json` excludes `tests/**` from build output.
- **Prompts under `src/agent/prompts/` are loaded at runtime via `tsx`.** This project runs through `tsx` end-to-end — there is no `tsc && node dist/...` build step. The `research.ts` and `outreach.ts` modules read their prompt files inline (`fs.readFileSync('src/agent/prompts/brain.md', 'utf8')`) — no shared loader helper.
- **Import paths use `.ts` extensions, not `.js`.** Source and test files both import as `from '../src/agent/research.ts'` — extensions match how `tsx` resolves the file at runtime, and `allowImportingTsExtensions: true` in §4.3 keeps `tsc` happy. Mixing `.js` imports for some files and `.ts` for others splits the test suite into two styles and produces type-check errors that look like project-wide drift; pick one — `.ts` — and apply it everywhere.
- **Static data tied to a single consumer** (e.g. the Tavily blocklist) lives **inline** in the consuming file as a `const`.
- **`preferences.md` lives next to the code that owns it** — `src/memory/preferences.md`. No top-level `data/` directory.
- **No CLI entry point.** The agent is invoked from inside Claude Code in plain English ("Research Stripe"), which calls `researchCompany` / `draftOutreach` directly. The only npm script is `test`. See §5.

## 2. Goals
<!-- The five things v1 must do to count as done. -->

1. **Research a company** and produce a structured lead profile: company overview, buying signals, lead score, score reasoning, suggested sales angle.
2. **Persist results to Airtable** as a real prospect pipeline — one row per company, no duplicates.
3. **Draft personalized outreach** that references the agent's actual research findings and is logged to a linked `Outreach` table.
4. **Apply user preferences across runs.** The agent reads its preferences memory at the start of every run and shapes its analysis (and outreach) to match — angle, structure, tone. Preferences are saved on the user's say-so, never auto-inferred.
5. **Be observable.** Tool calls, search queries, and decisions stream to the terminal so the user can see what the agent is doing in real time.

## 3. Non-goals (v1)
<!-- What we're explicitly NOT building — push back if these come up. -->

- Web UI / kanban board / chat interface — this is a console agent.
- Multi-user or team usage.
- Multi-tool orchestration with 5+ tools — we ship with one research tool, three preference-memory tools, and one outreach tool.
- Auto-saved memory / agent-inferred patterns — saving things the user did not explicitly state. Would require evals to keep memory clean.
- Cross-run dedup, prospect cache, interaction history, and follow-up-vs-first-touch outreach branching. The agent re-researches a company every time and always drafts as a first-touch email.
- Sending email — the agent **drafts** outreach. The user sends.
- Production guardrails (rate limiting, cost caps, output filtering, human-in-the-loop approval).
- Evals (output-quality testing).

## 4. Architecture — the four components
<!-- The four-component model (Brain, Tools, Memory, Loop), the repo layout, and the pinned dependencies. -->

The agent is built around four components — Brain, Tools, Memory, Loop. Here's how each shows up in this build:

| Component | What it does | Implementation |
|---|---|---|
| **Brain** | Reasons about each company, decides what to search, scores leads, drafts emails. | Claude (Haiku 4.5), accessed through the Anthropic API, called via the **Vercel AI SDK** (`@ai-sdk/anthropic`). Model is a project constant hardcoded at the call site in `src/agent/research.ts` (per §14.2) — swap directly in code (e.g. to `claude-sonnet-4-5`) for production-grade output. |
| **Tools** | Four **exploratory tools** the agent calls inside the loop: `searchWeb` plus three preference-memory tools (`listPreferences`, `addPreference`, `removePreference`). Structuring and Airtable persistence run in code, outside the loop, bracketing `generateText`. | **Tavily** for search — `fetch` against Tavily's REST API, wrapped in the Vercel AI SDK's `tool()` helper inside `src/tools/tavily.ts`. No `@tavily/core` SDK. · **Airtable** for the post-loop prospect upsert — connected via the Vercel AI SDK's `experimental_createMCPClient` (imported from `@ai-sdk/mcp@~0.0.18`, Vercel's MCP companion package paired with `ai@5`) over Streamable HTTP (`transport.type: 'http'`) to `https://mcp.airtable.com/mcp/`. The MCP tools are called directly from `researchCompany`'s code; they are NOT exposed to the Brain inside the loop. No `airtable-mcp-server` package — connection is to a hosted endpoint, not a local server. · Three preference helpers in `src/memory/preferences.ts`, each wrapped with `tool()` and exposed to the Brain inside the loop. See §10 for the memory model and §12.1 for which tools belong inside the loop. |
| **Memory** | Carries user preferences across runs — the lens through which the agent shapes analysis and outreach. The agent reads preferences at the start of every run and applies matching ones. Saves are explicit user requests; the agent never invents preferences the user did not state. | Local Markdown file at `src/memory/preferences.md`. Managed by three `tool()`-wrapped helpers (`listPreferences`, `addPreference`, `removePreference`) inside `src/memory/preferences.ts`. Airtable holds **prospect data** — that's the prospect pipeline, not memory. |
| **Loop** | The think → act → observe cycle that drives every research run. | Run by the Vercel AI SDK. Configured by system prompts at `src/agent/prompts/brain.md` and `outreach.md`. |

### 4.1 Architecture at a glance

```
─── invocation 1 ──────────────────────────────────────────────────────────────

                     user: "Research Stripe"
                             │
                             ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  researchCompany                                                 │
   │                                                                  │
   │  ┌─────────────────────────────────┐     ┌──────────────────┐    │
   │  │ generateText — inside the loop  │  ⇄  │  Anthropic LLM   │    │
   │  │                                 │     │  (the Brain,     │    │
   │  │ · system prompt                 │     │   many calls)    │    │
   │  │ · tools (called by the Brain):  │     └──────────────────┘    │
   │  │     searchWeb (Tavily)          │                             │
   │  │     listPreferences             │                             │
   │  │     addPreference               │                             │
   │  │     removePreference            │                             │
   │  └────────────────┬────────────────┘                             │
   │                   ▼                                              │
   │            free-form analysis                                    │
   │                   │                                              │
   │                   ▼                                              │
   │  ┌─────────────────────────────────┐     ┌──────────────────┐    │
   │  │ generateObject — after the loop │  ⇄  │  Anthropic LLM   │    │
   │  │ (structureProspect)             │     │  (the Brain,     │    │
   │  │                                 │     │   one-shot)      │    │
   │  │ · ProspectSchema (data schema)  │     └──────────────────┘    │
   │  └────────────────┬────────────────┘                             │
   │                   ▼                                              │
   │            structured prospect                                   │
   └───────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
                    Airtable
            (upsertProspect → Prospects table)


              ⋮  time passes — seconds, hours, or days  ⋮
              ⋮  the Prospects row persists in Airtable ⋮


─── invocation 2 ──────────────────────────────────────────────────────────────

                user: "Draft outreach for Stripe"
                             │
                             ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  draftOutreach                                                   │
   │                                                                  │
   │  ┌──────────────────────────────────┐    ┌──────────────────┐    │
   │  │ generateObject — no loop         │ ⇄  │  Anthropic LLM   │    │
   │  │                                  │    │  (the Brain,     │    │
   │  │ · reads prospect from Airtable   │    │   one-shot)      │    │
   │  │ · reads preferences.md           │    └──────────────────┘    │
   │  │ · system prompt · OutreachSchema │                            │
   │  └────────────────┬─────────────────┘                            │
   │                   ▼                                              │
   │            outreach record                                       │
   └───────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
                    Airtable
            (createOutreach → Outreach row,
             linked to the Prospects row)
```

`researchCompany` and `structureProspect` are sibling top-level exports in `src/agent/research.ts` (see §1.2, §12.2), not nested functions. `researchCompany` orchestrates the pipeline in code: it runs the `generateText` loop, then calls `structureProspect` (a second LLM call via `generateObject`), then calls `upsertProspect` to write to Airtable.

Exploratory tools (`searchWeb`, the three preference helpers) live *inside* the loop; the schema-typed extraction (`generateObject` + `ProspectSchema`) and the Airtable upsert run *after* `generateText` returns, as deterministic post-loop steps. The loop boundary is specified in §12.1; memory placement in §10.3; outreach drafting follows the same shape in §11.

### 4.2 Dependencies

Install exactly these packages, pinned to the version lines below, and nothing else. The pins are deliberate — the codebase, prompts, and teaching script are all written against `ai@5`'s API surface, and `ai@6` introduces a breaking change (deprecates `generateObject`) that this workshop does not adopt. The "Do NOT install" list pins the wrong picks `npm install` defaults to silently.

**Runtime (`dependencies`):**
- `ai@^5` — Vercel AI SDK core. Provides `generateText`, `generateObject`, `tool()`, and `stepCountIs` (used with `generateText`'s `stopWhen` option to bound the loop).
- `@ai-sdk/mcp@~0.0.18` — Vercel's MCP client for the AI SDK, paired with `ai@5`. Exports `experimental_createMCPClient`. The MCP client was extracted from `ai` core in `5.0.79`, so any current `ai@^5` install needs this companion package. **Pin to `~0.0.18`, not `^1`** — `@ai-sdk/mcp@^1` (the `latest` tag on npm) pairs with `ai@6` and depends on `@ai-sdk/provider@3`, while `ai@^5` and `@ai-sdk/anthropic@^2` depend on `@ai-sdk/provider@2`. The mismatch means MCP-discovered tools will not type-check when passed into `generateText` (TypeScript reports `'SharedV3ProviderOptions' is not assignable to 'SharedV2ProviderOptions'`). Vercel's `ai-v5` dist-tag on `@ai-sdk/mcp` points to `0.0.18`; that is the v5-paired line.
- `@ai-sdk/anthropic@^2` — Anthropic provider for the SDK, paired with `ai@5`. (`@ai-sdk/anthropic@3` pairs with `ai@6` and is the wrong choice here.)
- `zod` — schemas for `ProspectSchema` and `OutreachSchema`. Either v3 or v4 is fine.

**Dev (`devDependencies`):**
- `typescript@^5` — pin to the v5 line. v6 is the current `latest` on npm but is not validated against this codebase.
- `tsx@^4` — runs `.ts` files directly; no build step.
- `vitest@^3` — test runner (configured by the `test` npm script). Pin to v3; v4 is current `latest` but is not validated here.
- `@types/node@^22` — matches the Node 22 runtime.

**Pin discipline:** when you run `npm install`, do not accept the default of "latest of everything." Set the version range in `package.json` first (or pass `package@^5` form on the install line). A fresh `npm install ai` today resolves to `ai@6` and pulls in everything else at latest, which produces the wrong dependency tree.

**Do NOT install:**
- ❌ `ai@6` (or any major above v5) — `ai@6` deprecates `generateObject`, which §11.1 and §12.4 depend on. Stay on v5 unless a future PRD revision migrates the API explicitly.
- ❌ `@ai-sdk/mcp@^1` (or any version on the `1.x` line) — `1.x` pairs with `ai@6` and brings in `@ai-sdk/provider@3`, which is type-incompatible with the `provider@2` that `ai@^5` uses. Use `~0.0.18` instead, per the runtime-deps note above.
- ❌ `@tavily/core` or any Tavily client SDK — Tavily's REST API is called directly with `fetch`. The lesson in video 2.2 is wrapping the raw API to control what the Brain sees; an SDK would hide that.
- ❌ `airtable-mcp-server` or any `@modelcontextprotocol/server-*` package — connection is to Airtable's **hosted** MCP endpoint (`https://mcp.airtable.com/mcp/`) over Streamable HTTP via the SDK's MCP client (`transport.type: 'http'`). There is no local MCP server to install. Note: Airtable migrated this endpoint from SSE to Streamable HTTP — `transport.type: 'sse'` now returns `405 Method Not Allowed`.
- ❌ `airtable` (the official Airtable JS client) — the MCP client is the only path to Airtable.
- ❌ `dotenv` — Node 22+ supports `--env-file=.env` natively, and vitest is wired the same way. No package needed. The exact `test` script and the runner contract live in §16.2.
- ❌ `commander` / `yargs` / any CLI framework — there is no CLI entry point (see the conventions above).
- ❌ `maxSteps: N` as the loop bound — that's the v4 `generateText` knob. On `ai@^5` it's silently dropped and the agent loop terminates after step 1, so tool calls happen but no synthesis turn ever runs. Use `stopWhen: stepCountIs(N)` (imported from `'ai'`) instead.
- ❌ `parameters` as the schema field on `tool({ ... })` — that's the v4 name. On `ai@^5` the field is `inputSchema`. TypeScript does not name the rename: the `Tool<>` overload falls through to `Tool<never, never>` (which forbids `execute`), and the resulting error is `"execute is not assignable to type 'undefined'"` — confusing, since the real cause is the field rename. Use `inputSchema: z.object({ ... })`.
- ❌ `tool.execute(input)` single-arg call form — that's the v4 signature. On `ai@^5`, `execute` is `(input, options: ToolCallOptions)` where `ToolCallOptions` requires `{ toolCallId: string, messages: ModelMessage[] }`. Every test that invokes a tool directly must pass a stub: `await searchWeb.execute!(input, { toolCallId: 'test', messages: [] })`. Without it, TS reports the result as `unknown` and every call-site errors.
- ❌ Re-export `searchWeb` (or any `tool()`-wrapped helper) with a narrowed `execute` return type via `Omit<typeof _searchWebTool, 'execute'> & { execute: ... } = _searchWebTool as never` — that intersection no longer pattern-matches `Tool<INPUT, OUTPUT>`, so passing the narrowed export into `generateText`'s `tools` map (per §12.2) fails `tsc --noEmit` with `Type '{ query: string; recencyDays?: number | undefined; }' is not assignable to type 'never'` on `inputSchema`. The narrowing was designed for the test call-site (`await searchWeb.execute!(input, opts)`) but breaks the loop call-site — `searchWeb` has two consumers, one symbol. Keep the export wide; `ai@^5`'s `Tool<INPUT, OUTPUT>` declares `execute` returning `AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT` regardless of the callback annotation, and that is the shape the tools map slot expects. **Cast at the test call-site instead of narrowing the export:**

  ```ts
  // src/tools/tavily.ts — wide export, fits both consumers
  type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

  export const searchWeb = tool({
    description: '...',
    inputSchema: z.object({
      query: z.string(),
      recencyDays: z.number().int().positive().optional(),
    }),
    execute: async ({ query, recencyDays }): Promise<SearchResult[]> => {
      /* ... */
    },
  });

  // tests/tools/tavily.test.ts — cast on the consumer side
  import type { ToolCallOptions } from '@ai-sdk/provider-utils';

  const results = (await searchWeb.execute!(
    { query: 'q' },
    { toolCallId: 'test', messages: [] } satisfies ToolCallOptions,
  )) as SearchResult[];
  ```

  Vitest does not type-check; `tsc --noEmit` (§16.2) is what surfaces both the wide-union return at test call-sites and any tools-map mismatch. The principle: when a single export has two consumers with incompatible type constraints, prefer to narrow at the call-site of the constrained consumer, not at the export — narrowing at the export silently breaks the other consumer.

### 4.3 `tsconfig.json` — canonical contents

Use **exactly** this configuration. Do not invent variations. The project runs end-to-end via `tsx` — `tsc` is type-check-only, never emits, and must check both `src/**/*` and `tests/**/*`. A `dist/` directory should never appear; if it does, the config has been changed and needs reverting.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules"]
}
```

Common wrong choices to avoid:
- ❌ Setting `outDir`, `rootDir`, or `noEmitOnError` — meaningless when `noEmit: true`. They mislead future readers into thinking there's a build output.
- ❌ Excluding `tests/**` from `include` — `tsc` then can't type-check the tests, defeating the point of having TypeScript tests.
- ❌ Listing `dist` in `exclude` — there is no dist; mentioning it implies one exists.
- ❌ Dropping `allowImportingTsExtensions` — the project uses `.ts` extensions on imports (per the §1.2 convention) so they match how `tsx` resolves them at runtime. Without this flag, every `.ts` import errors during type-check and the test suite splits between `.ts` and `.js` import styles.

`.gitignore` does not need to mention `dist/` — the config never produces one. Harmless if present.

## 5. CLI interaction
<!-- How the agent is invoked — plain English from Claude Code, not a command-line script. -->

The agent is invoked from inside Claude Code in plain English — there is no command-line entry point. Students type a request like "Research Stripe" and Claude Code calls `researchCompany` / `draftOutreach` directly with the company name. This matches how the agent is demoed throughout the course videos.

### 5.1 How to invoke

| Action | What you type into Claude Code |
|---|---|
| Research a company | "Research Stripe" |
| Draft outreach | "Draft outreach for Stripe" — errors if no prior research |
| Both in sequence | "Research Stripe and then draft outreach" |
| Run tests | `/tdd` — or `npm test` directly |

The only npm script is `test` (vitest). No `npm run research`, no `cli.ts`, no subcommand dispatcher.

### 5.2 Streaming output

Every run prints what the agent is doing in real time. At minimum:

```
$ Research Stripe

Researching Stripe...
[tool]   listPreferences() → 2 preferences loaded
[brain]  no shipping-related preference applies; proceeding with default angle
[tool]   searchWeb("Stripe recent news funding hiring 2026")
[tool]   → 5 results (stripe.com, techcrunch.com, ...)
[brain]  analyzing signals, scoring lead...
[brain]  final analysis ready
[code]   structureProspect → typed prospect
[code]   airtable.upsert → Stripe written to Prospects

✓ Stripe — score 85 — written to Airtable.
```

## 6. Inputs
<!-- The company name format the agent accepts and how it's normalized into a stable key. -->

- Company **name** (e.g. `Stripe`) is the canonical input.
- The agent normalizes the input to a canonical key (lowercase, no whitespace) for memory lookup and as the Airtable primary field. Stripe and `stripe` and `STRIPE` all resolve to the same record.
- Domains (e.g. `stripe.com`) are accepted; the agent strips the TLD for the canonical key.

## 7. Prospect data model
<!-- The structured shape every research output must match — Zod schema, field rules, and the honesty rule. -->

The agent's research output is **structured JSON validated by Zod**, not freeform text. Structured output is what makes the data downstream-usable (Airtable upsert, outreach drafting, memory comparisons) without re-parsing.

### 7.1 Schema

```typescript
const ProspectSchema = z.object({
  companyName: z.string(),
  domain: z.string(),                                // canonical key — set by caller, not the model. See §7.4.
  overview: z.string(),                              // 1–2 paragraphs
  signals: z.array(z.object({
    name: z.string(),                                // e.g. "Hiring activity"
    description: z.string(),                         // e.g. "47 open roles in enterprise sales"
    strength: z.enum(['strong', 'moderate', 'weak']),
  })).min(1),
  leadScore: z.number().int().min(1).max(100),
  scoreReasoning: z.string(),                        // why this number
  suggestedAngle: z.string(),                        // how to open the conversation
  lastResearched: z.string().datetime(),             // ISO 8601, auto-set
});

export type Prospect = z.infer<typeof ProspectSchema>;
```

### 7.2 Field rules

- **`domain`** — canonical key (lowercase, no TLD). **Set deterministically by the caller** (`researchCompany`) from the normalized `companyName`, never extracted from the analysis text or invented by the model. The structurer omits this field from the schema passed to `generateObject` and the caller attaches it after — same pattern as `lastResearched`. See §7.4.
- **`overview`** — 1–2 paragraphs. What the company does, who it serves, current trajectory.
- **`signals`** — at least one. Each has a name, a one-line description with concrete numbers where possible, and a strength rating.
- **`leadScore`** — integer 1–100 per the rubric in §8.
- **`scoreReasoning`** — explain the number. "Strong growth signals (47 open roles, recent partnership) but likely builds in-house — best angle is developer infra."
- **`suggestedAngle`** — one sentence on the strongest pitch.
- **`lastResearched`** — ISO 8601 datetime. **Set deterministically by the caller** from `new Date().toISOString()`, never invented by the model. Same omit-from-schema pattern as `domain`. See §7.4.

### 7.3 Honesty rule

If the agent cannot find substantive evidence for a signal or the score, it says so. **Hallucinating to fill space is worse than admitting the gap.** Never invent funding rounds, headcount numbers, or quotes. If sources are thin, that's reflected in `scoreReasoning` ("Limited public info — score reflects high uncertainty.") and in a lower score.

### 7.4 No silent fallbacks for load-bearing fields

A **load-bearing field** is any field used as a primary key, dedup target, or foreign reference. In this schema, that's `domain` (Airtable upsert key per §13.2). Load-bearing fields must not be invented by the model and must not be silently derived by code as a fallback when extraction fails.

The pattern this PRD adopts:

1. The structurer (`structureProspect`) calls `generateObject` with `ProspectSchema.omit({ domain: true, lastResearched: true })` — the model has no slot to invent `domain`. (`lastResearched` is also omitted; it's not load-bearing, but it is canonical metadata set by the caller, not the model.)
2. The caller (`researchCompany`) attaches both after the structurer returns: `domain` from the normalized `companyName` (lowercase, alphanumerics only — see §6), `lastResearched` from `new Date().toISOString()`.
3. The final object is validated against the full `ProspectSchema` (with `domain` and `lastResearched` required) before persistence.

Why this matters: without this rule, code can silently fill in a derived `domain` (e.g. `companyName.toLowerCase().replace(/[^a-z0-9]/g, '')`) inside the *structurer* when the model returns a partial result. A later run with a real domain then creates a duplicate row instead of upserting. Without `domain` as a stable upsert key, every run on the same company creates a new row. The deterministic-attach-by-caller pattern is the canonical derivation: `domain`'s source-of-truth is the input (the company name), not the analysis text.

## 8. Lead score rubric
<!-- How the agent picks a 1–100 score and what each band means. -->

The score reflects the agent's assessment of fit + buying signals + timing.

| Score | Meaning |
|---|---|
| **80–100** | Strong lead. Multiple strong buying signals. Clear product/market fit. Pursue. |
| **60–79** | Promising. Some signals. Worth a personalized outreach. |
| **40–59** | Moderate. Limited signals. Needs more research before prioritizing. |
| **1–39** | Weak. Few signals or wrong fit. Low priority. |

Every score must come with `scoreReasoning`. A bare "85" with no explanation is invalid output.

## 9. Buying signals taxonomy
<!-- The categories of evidence the agent looks for when deciding if a company is a buyer. -->

The agent looks for signals in these categories:

| Category | Examples |
|---|---|
| **Hiring activity** | Open roles in sales/marketing/engineering, especially recent. Numbers matter ("47 open roles" beats "they're hiring"). |
| **Funding & growth** | Recent funding rounds, revenue milestones, public earnings beats. |
| **Market expansion** | New geographies, new product lines, partnerships, acquisitions. |
| **Technology adoption** | Public commitments to new platforms, dev hires, technical blog posts. |
| **Pain points** | Reviews, press, public complaints that match what we sell. |

**Anti-spam rule:** SEO listicles, generic engineering blog posts unrelated to specific events, and ad-driven roundups are excluded. Press releases, funding announcements, leadership changes, product launches — those count. The system prompt enforces this.

## 10. Memory model
<!-- How user preferences are stored and used — one Markdown file, three tools, manual saves only. -->

Memory in this agent stores **user preferences** — the lens through which the agent shapes its analysis and outreach. One Markdown file, three tools the Brain calls inside the loop. Saves are explicit user requests; the agent never invents preferences the user did not state.

### 10.1 What memory holds — and doesn't

Memory in v1 holds one thing: user preferences. Examples:

- "For shipping and logistics companies, lead with 24/7 multilingual deflection — they ship globally, customers email in every language."
- "Always include the prospect's recent hiring trajectory in the overview section."
- "Prefer subject lines under 50 characters."

What memory does **not** hold:

- **Prospect facts.** Those live in Airtable as the prospect pipeline. Airtable is a tool the agent uses, not memory.
- **Interaction history, follow-up tracking, dedup state.** Out of scope for v1 (§3).
- **Anything the agent infers without the user telling it.** All saves are user-initiated. No auto-inference, no agent-decided memory.

### 10.2 Storage — `src/memory/preferences.md`

One Markdown file. The agent reads it, the agent writes it.

```markdown
# Preferences

- For shipping and logistics companies, lead with 24/7 multilingual deflection — they ship globally and customers email in every language.
- Always include the prospect's recent hiring trajectory in the overview section.
- Prefer subject lines under 50 characters.
```

### 10.3 Tools — three of them, all inside the loop

The agent has three preference tools in its tools map, alongside `searchWeb`:

| Tool | Purpose |
|---|---|
| `listPreferences()` | Reads `preferences.md` and returns its content as a string. Returns an empty string when the file does not yet exist. |
| `addPreference(text)` | Appends a new bullet to `preferences.md`. Creates the file (with the `# Preferences` header) on first write. Idempotent on exact-match — adding the same text twice does not duplicate. |
| `removePreference(text)` | Removes a matching bullet from `preferences.md`. Match is case-insensitive substring; if multiple match, removes only the first. |

Each is wrapped with `tool()` from the Vercel AI SDK and added to `researchCompany`'s tools map. The Brain decides when to call them; there is no code-side prefetch. The three are inside the loop because relevance ("does any saved preference apply?") and intent recognition ("did the user just state a save-worthy preference?") are exploratory — see §12.1.

### 10.4 How memory shapes a run — the manual-save pattern

The agent is invoked with the user's full natural-language message, not just a company name, so the Brain can recognize both research requests and stateful feedback in the same call. brain.md instructs:

1. **Always start by calling `listPreferences()`.** Apply matching preferences during analysis. Cite which preferences applied in the narrated output (e.g. "Applying saved preference: for shipping companies, lead with multilingual.").
2. **If the user's message contains a stateful preference** ("for shipping always lead with X", "always include Y", "prefer subject lines under 50 characters"), call `addPreference(text)` and acknowledge in the response: `Saved preference: <text>`.
3. **If the user asks to remove a preference** ("forget that multilingual rule", "remove the hiring snapshot one"), call `removePreference(text)` and acknowledge.
4. **Never invent a preference the user did not state.** Saves are explicit user requests only — no auto-inferring from conversation context, prospect data, or analysis outcomes.

Saves happen on the same turn the user states the preference (one-shot call — no proactive-offer-then-confirm pattern). The user can `removePreference` if a save was a mistake.

**How preferences compose with the rubric (composition rules).** Saved preferences modify how the rubric and the honesty rule apply on this run. brain.md instructs:

- **Signal elevation.** When a preference classifies a signal as strong, that signal alone supports a Lead score in the 60–79 band. The 80+ band still requires multiple strong signals.
- **Penalty suspension.** When a preference reframes the *absence* of a signal as neutral or expected for a category (e.g. *"missing public CX hiring is normal in this vertical, support is staffed via BPOs"*), do not list that absence as a weakness and do not reduce the score for it.
- **Honesty rule, narrowed.** "Thin sources → lower score" still applies to dimensions a preference does *not* address. It does not apply to dimensions a preference explicitly speaks to — the preference is the substantive evidence for that dimension.
- **Angle binding.** When a preference specifies a default angle for a category or signal pattern, use it in `Suggested angle`. Do not output *"skip for now"*, *"wait and monitor"*, or *"hold off"* for a prospect an active preference covers.

## 11. Outreach drafting
<!-- How the agent writes the personalized email — schema, behavioral rules, and what the prompt must contain. -->

### 11.1 Schema

```typescript
const OutreachSchema = z.object({
  subjectLine: z.string().max(80),
  emailBody: z.string(),
  angleReasoning: z.string(),
});

export type Outreach = z.infer<typeof OutreachSchema>;
```

### 11.2 Rules

- **At least two specific findings** from the prospect's research must be referenced. No generic templates.
- **Subject line under 80 characters.**
- **Apply user preferences.** `draftOutreach` reads `src/memory/preferences.md` and applies matching preferences (e.g. "prefer subject lines under 50 characters", "always include a question in the first paragraph"). Preferences are read in code here, not via the `listPreferences` tool — see §12.4 for why.
- The agent does **not** have access to web search during outreach drafting. It works from the prospect record and preferences only — research is research, drafting is drafting. (Separation of concerns.)
- **No outreach without prior research.** Calling `outreach` on a company with no prospect record errors with `"Research <Company> first."`
- **Env validation runs first.** `draftOutreach` checks `ANTHROPIC_API_KEY` before any Airtable lookup, prompt load, or model call. Throws a clear, actionable error mentioning `ANTHROPIC_API_KEY` if missing. Order matters: doing Airtable first means the missing-env test (§16.1) surfaces an Airtable connection error in no-env CI and fails for the wrong reason.
- **Always drafts as a first-touch email.** Follow-up vs first-touch branching is out of scope (would require interaction history; see §3 non-goals).

### 11.3 Persistence

Each draft is saved as a row in the Airtable `Outreach` table, linked to the prospect record. The write goes through the `createOutreach(client, prospectId, outreach)` helper in `src/tools/airtable.ts` (per §12.3) — `draftOutreach` does not call `create_records_for_table` inline, because the §12.3 lookup-and-envelope rules and the linked-record write contract (`typecast: true` per §13.4) must be applied uniformly. The draft itself is also printed to the terminal so the user can read it without opening Airtable. No HTML preview files are written — Airtable is the source of truth.

### 11.4 System prompt — required contents

The system prompt at `src/agent/prompts/outreach.md` is part of the spec, not an implementation choice the model gets to make on each regeneration. When the prompt is next written or updated, it must contain all seven of the following. If any are missing, the prompt is incomplete — fix the prompt, not this section.

1. **Vendor context (per §1.1).** Use the canonical product description verbatim — do not paraphrase the four product modalities into different wording. This rule prevents drift between `brain.md`'s product description and `outreach.md`'s product description.
2. **Behavioral rules (per §11.2).** Each rule must be enforceable from the prompt's text — reference ≥2 specific signals from the prospect data, ≤80-character subject line, apply user preferences, no web search, no follow-up framing, no persistence (the caller writes to Airtable).
3. **Tone.** Direct. Specific. Confident, not deferential. One observation or one question per paragraph. **Forbid filler phrases by name** — at minimum: "I hope this email finds you well", "I came across your company", "I wanted to reach out", "circling back", "just checking in". A real human writing a personalized note does not use these.
4. **Body length.** 4–8 sentences. Plain text only — no HTML, no signature line, no markdown formatting in the body.
5. **Structure.** Open with the connection (a specific signal the agent observed in the prospect data), pivot to the relevant vendor capability, close with a low-friction CTA — a specific question or open-ended offer. **Not a meeting ask on first touch** — a meeting ask before any back-and-forth converts poorly and signals templated outreach.
6. **Honesty rule.** Every concrete claim in the email body must trace to the prospect data passed in. The agent does not invent signals, headcount, funding, partnerships, customers, or quotes. If the prospect data is thin, the email is short — do not pad with filler.
7. **At least one worked example.** Include a strong-signal first-touch example showing the input (a prospect record summary) and the output (subject, body, `angleReasoning`). Examples constrain output more reliably than abstract rules. The example should reference at least two specific signals by name and demonstrate the connection-→-capability-→-CTA structure. **Render the example output as prose with readable labels (`Subject:`, `Body:`, `Angle reasoning:`), not as a JSON object literal.** §11.1's schema is enforced by `generateObject` per §12.4 — duplicating the JSON shape inside the prompt causes the prompt's copy of the shape to drift from §11.1 across revisions, and the model treats the example as the contract instead of the schema.

## 12. Tool surface
<!-- Every tool the agent uses and where it lives — inside the loop (the Brain decides) or outside (code guarantees). -->

### 12.1 The loop boundary — exploratory inside, deterministic outside

The agent loop is reserved for **exploratory tool use** — work where the Brain's judgment matters: choosing what to search, when to stop, how to interpret partial results, which preferences apply, whether the user just stated something stateful. **Deterministic guarantees** — schema-validating output, persisting prospects to Airtable — run in **code**, outside the loop, after `generateText` returns.

In this agent, four tools live **inside** the loop:

- `searchWeb` — exploratory by design; the Brain decides what to query and when to stop.
- `listPreferences`, `addPreference`, `removePreference` — exploratory because the Brain decides relevance ("does any saved preference apply to this prospect?") and recognizes user intent ("did the user just state a save-worthy preference?").

Outside the loop:

- The structurer — a `generateObject` call that turns the Brain's free-text analysis into a typed `Prospect`.
- The Airtable upsert — deterministic write to the `Prospects` table.

### 12.2 Tools inside the loop

Four tools are exposed to the Brain inside the loop:

| Tool | Module | Source | Purpose |
|---|---|---|---|
| `searchWeb(query)` | `src/tools/tavily.ts` | Tavily, hand-wrapped via `tool()` | Web search. Filters SEO-spam domains (blocklist inlined as a `const` at the top of the file), enforces a recency window, and reshapes results to the fields the Brain needs. |
| `listPreferences` / `addPreference` / `removePreference` | `src/memory/preferences.ts` | Local Markdown file, hand-wrapped via `tool()` | The three preference tools — full schemas in §10.3. |

The MCP-discovered Airtable tools (`upsertProspect`, etc.) are NOT exposed to the Brain — they are called directly from `researchCompany`'s code after the structurer runs. See §12.3.

### 12.3 Operations outside the loop (code-side, deterministic)

These do **not** appear in the agent's `tools` map. They run in `researchCompany`'s code after `generateText` returns. There are no pre-loop code-side reads in this design — memory is read by the Brain via `listPreferences`; see §10.

**`researchCompany`'s final return shape (after the `(structurer + persistence)` build) is `{ prospect: Prospect, steps: Step[] }`** — the typed prospect plus the agent loop's `steps` array (the Vercel AI SDK's per-step trace, with tool calls and results). Both are load-bearing for the test suite: the `prospect` field is what §16.1's `(structurer + persistence)` bullets validate against `ProspectSchema`; `steps` is what §16.1's `(search wiring)` bullet inspects to assert `searchWeb` was called (`steps.length > 1` plus tool-call inspection). Do not flatten this into just `Prospect` — the `(search wiring)` spec test cannot be written without `steps` in the return. Do not add other fields.

The shape evolves across stages: `(researchCompany seed)` returns plain text (`result.text` from `generateText`); `(search wiring)` widens to expose `.steps` so the search-invocation test can run; `(structurer + persistence)` narrows to the typed `{ prospect, steps }`. Tests added at earlier stages must be rewired (not dropped) when the shape changes — the `(researchCompany seed)` smoke test and `(search wiring)` search-invocation test both keep passing against the `(structurer + persistence)` shape (per the script's `(structurer + persistence)` prompt).

| Operation | When | Module | Source | Purpose |
|---|---|---|---|---|
| `structureProspect(text, companyName)` | After loop | `src/agent/research.ts` (exported for direct testing — see §16.1; not imported anywhere in production except `researchCompany`) | Vercel AI SDK `generateObject` | Turns the agent's free-text analysis into a typed `Prospect`. Calls `generateObject` with `ProspectSchema.omit({ domain: true, lastResearched: true })` — `domain` is load-bearing per §7.4, `lastResearched` is canonical metadata set by the caller, neither belongs in the slot the model fills. Returns a partial; the caller attaches `domain` (from normalized `companyName`) and `lastResearched` (from `new Date().toISOString()`), then validates against the full `ProspectSchema`. Lives inside `research.ts` (colocated with `researchCompany` and `ProspectSchema`) — do not split into its own file; that creates an ESM cycle the omit-pattern is not meant to work around. |
| `upsertProspect(prospect)` | After loop | Airtable MCP via `src/tools/airtable.ts` | Airtable MCP client | Persists the typed prospect to the `Prospects` table. The MCP client is opened at the top of `researchCompany` and closed in `finally`; the lifecycle is handled by the helper in `src/tools/airtable.ts`. |

**`structureProspect`'s `generateObject` prompt is pinned verbatim.** Paraphrasing causes silent extraction drift: different wording yields different field shapes for the same analysis. Use exactly this string (interpolating `companyName` and `analysisText`):

```
Extract a structured prospect for ${companyName} from the analysis below. Every field must come from the analysis text — do not invent values. Each signal's `strength` must be one of: strong, moderate, weak.

Analysis:
${analysisText}
```

The prompt is a spec artifact, not implementation choice — the schema is enforced by `generateObject`; the prompt's job is to forbid invention and pin the strength enum.

**`upsertProspect`, `getProspectByDomain`, `getProspectIdByDomain`, `listOutreachByProspectId`, `createOutreach`, `deleteProspectByDomain`, and `deleteOutreachByProspect` are the local wrappers, not discovered MCP tool names.** Airtable's hosted MCP server exposes the CRUD primitives by exact name — `list_tables_for_base`, `list_records_for_table`, `create_records_for_table`, `update_records_for_table`, `delete_records_for_table` — discovered at runtime via `client.tools()` and looked up by exact key. Fuzzy lookup is not permitted: `/create.records?/i` matches `create_record_comment` before `create_records_for_table`, which routes writes to the wrong tool. If the server renames a primitive, the §16.1 Airtable suite goes red and §12.3 + §13.4 are updated together. The local helpers in `src/tools/airtable.ts` compose them by capability.

**Build-stage tags.** Each helper bullet below is tagged with the stage at which it lands in `airtable.ts`. The tag is *additive provenance*: a helper added at "outreach test-prep" must exist before `tests/outreach.test.ts` is written, and a helper tagged "outreach impl §11" lands with `draftOutreach`. Stages must not be collapsed — production helpers (consumed by `researchCompany` or `draftOutreach`) land with the function that calls them; **test-only helpers** (verifier reads, cleanup deletes) land with the test file that imports them, NOT with the production function. Skipping a test-prep helper to the impl stage breaks the "tests are written first against helpers that already exist" sequence and forces a stop-and-surface mid-test-writing.

- `upsertProspect(client, prospect)` — list `Prospects` filtered by `domain == prospect.domain` via `list_records_for_table`, then `update_records_for_table` if a match is found or `create_records_for_table` otherwise. **Build stage: `(structurer + persistence)`** (called by `researchCompany` after `structureProspect` returns).
- `getProspectByDomain(client, domain)` — list `Prospects` filtered on `domain == domain` via `list_records_for_table`, return `{ id, ...fields }` (the record ID plus every Prospects field, decoded from `r.cellValuesByFieldId[fldXXX]` per §12.3) or `null` on no-match. Idempotent on no-match. **Read primitive.** Used by `draftOutreach` (§12.4) — drafting needs both the record id (for the linked write to `Outreach`) and the field values (for LLM context: `companyName`, `signals`, `suggestedAngle`, etc.), and a single round trip beats two reads. **Distinct from `getProspectIdByDomain`** below: the id-only helper exists separately so §16.1 verification tests that only need the id do not pull the full record (smaller surface, faster, verifier stays minimal). **Build stage: `(outreach drafting)`** (added together with `draftOutreach`, since it is consumed only by `draftOutreach` in production).
- `getProspectIdByDomain(client, domain)` — list `Prospects` filtered on `domain == domain` via `list_records_for_table`, return the matching record ID (a `rec…` string) or `null` on no-match. Idempotent on no-match. **Read primitive.** Used by `deleteOutreachByProspect` and by §16.1 verification tests that need to assert "an Outreach row's link field references the seeded prospect's exact record ID." Lives in `airtable.ts` so the §12.3 lookup-and-envelope rules apply. **Build stage: `(structurer + persistence)` test-prep** (added before `tests/research.test.ts`, since research verification tests need it; reused later by `deleteOutreachByProspect` at outreach test-prep).
- `listOutreachByProspectId(client, prospectId)` — list `Outreach` via `list_records_for_table` and filter rows whose `prospect` linked field references `prospectId`. Returns the matching record IDs as a `rec…[]` array (empty array on no-match). Idempotent on no-match. **Read primitive.** Used by `deleteOutreachByProspect` and by §16.1 verification tests. The two reads are split apart from `deleteOutreachByProspect` deliberately: §16.1's prospect-link assertion must use the read primitives, NOT the delete helper's return count, so a buggy delete helper (dropped link filter, fuzzy match, off-by-one) cannot satisfy the verification test it was supposed to be tested by. Verifier and cleaner are different code paths. **Read shape note:** linked-record cells come back from `list_records_for_table` as `[{id, name}, ...]` objects on this MCP surface, not bare `rec…` strings. The filter must check both shapes — `entry === prospectId` for strings, `entry.id === prospectId` for objects — so a future MCP-side shape change does not silently drop matches. **Build stage: `(outreach drafting)` test-prep** (added before `tests/outreach.test.ts`, since the outreach persistence assertion imports it; it is NOT consumed by `draftOutreach` itself, so it must not be deferred to outreach impl).
- `createOutreach(client, prospectId, outreach)` — discover the `Outreach` table id and field-id map via `list_tables_for_base`, then `create_records_for_table` with `typecast: true` and a `fields` payload keyed by `fldXXX` IDs. The `prospect` field takes the linked-record write format `[prospectId]` (array of bare `rec…` strings). **`typecast: true` is load-bearing** for the linked write — without it, Airtable silently null-coerces the linked cell, the row is created with an empty `prospect` field, `isError` returns `false`, and the §16.1 id-match assertion correctly fails. See §13.4. **Used by `draftOutreach`** (§11.3 persistence) and never by production research paths. **Build stage: `(outreach drafting)`** (added together with `draftOutreach`, since it is the persistence path `draftOutreach` itself calls).
- `deleteProspectByDomain(client, domain)` — call `getProspectIdByDomain(client, domain)`; if a record ID is returned, `delete_records_for_table` for that ID. Returns the count of deleted rows (0 or 1). Idempotent on no-match. **Used by §16 test cleanup**, not by production code paths — but lives in `airtable.ts` (not in test code) so the §12.3 lookup-and-envelope rules apply uniformly. Tests must call this helper rather than running their own MCP tool-name discovery. **Build stage: `(structurer + persistence)` test-prep** (added before `tests/research.test.ts`, since research tests clean up via this helper; reused later by outreach test cleanup).
- `deleteOutreachByProspect(client, domain)` — call `getProspectIdByDomain(client, domain)`; if a record ID is returned, call `listOutreachByProspectId(client, prospectId)` and `delete_records_for_table` for the matching Outreach record IDs. Returns the count of deleted Outreach rows. Idempotent on no-match (no prospect found → 0; prospect found but no linked Outreach → 0). **Used by §16 test cleanup**, not by production code paths. Airtable does not cascade-delete linked records when a prospect is deleted — without this helper, every test run that exercises `draftOutreach` leaves orphan Outreach rows that accumulate across runs. Tests must call `deleteOutreachByProspect` *before* `deleteProspectByDomain` — deleting the prospect first orphans the Outreach rows and the linked-field lookup can no longer find them. **Build stage: `(outreach drafting)` test-prep** (added before `tests/outreach.test.ts`, since the outreach test's `afterAll` imports it; it is NOT consumed by `draftOutreach` itself, so it must not be deferred to outreach impl).

Implementation rules (apply to all three helpers):

- **Look up tools by exact name from `client.tools()`.** The required handles are `list_tables_for_base`, `list_records_for_table`, `create_records_for_table`, `update_records_for_table`, `delete_records_for_table`. Do not use fuzzy matching (e.g. `Object.keys(tools).find(n => /create.records?/i.test(n))`) — that pattern matches `create_record_comment` before `create_records_for_table` and routes writes to the comment tool. The discovered list is the source of presence (so the missing-capability check below still works), not the source of name resolution.
- **Inspect the MCP result envelope on every call.** Each tool returns `{ content: [...], isError: boolean, structuredContent? }`. If `isError: true`, throw with `content[0].text` — that is the §15 "Airtable write fails" path. Returning the result to a caller without inspecting `isError` is forbidden: failures arrive as success-shaped objects, not exceptions, and an unchecked return produces silent no-op writes. On success, prefer `structuredContent`; fall back to JSON-parsing `content[0].text`.
- **Discover the table ID and field-name → field-ID map once via `list_tables_for_base`.** Cache both. All subsequent calls to `list_records_for_table`, `create_records_for_table`, and `update_records_for_table` pass `tableId` (a `tbl…` ID, not the table name) and key the `fields` object by `fldXXX` IDs (not field names). Names are rejected by the current MCP surface.
- **Use the structured `filters` parameter for record lookups, not `filterByFormula`.** Shape: `{ operands: [{ operator: '=', operands: [domainFieldId, prospect.domain] }] }`. Unknown parameters (including `filterByFormula`) are silently dropped — `isError: false` does not mean "I applied your filter," it means "I accepted your call." A dropped filter returns the entire table; a write keyed off `records[0]` then corrupts the wrong row. As a defensive guard, after listing by domain `upsertProspect` must throw if the result contains more than one row — that condition means the filter was dropped (or there are duplicate-domain rows, which §13.2 forbids).
- **Write payloads use the plural `records: [{ fields: { fldXXX: value, … } }]` shape.** Single-record `fields: {...}` is rejected. Records returned from `list_records_for_table` carry their values on `r.cellValuesByFieldId[fldXXX]`, not `r.fields[name]`.
- **If an expected capability is missing from the discovered set** (no record-listing, creating, updating, or deleting tool with the names above), throw the §15 "Airtable write fails" error with a clear message naming the missing capability — never silently no-op or compose against the wrong tool.
- **The resolved tool handles, table ID, and field-ID map are checked once when the client opens; later invocations reuse them.**
- **Test code follows the same rules.** Cleanup goes through `deleteProspectByDomain` and `deleteOutreachByProspect`; **verification** (asserting persistence happened correctly) goes through `getProspectIdByDomain` and `listOutreachByProspectId` — never through ad-hoc lookups against `client.tools()`, and never by reusing the delete helpers' return counts as the verification signal. Verifier and cleaner are different code paths. Order matters: tests calling `draftOutreach` must run `deleteOutreachByProspect` before `deleteProspectByDomain`, or the linked-field lookup orphans Outreach rows it can no longer find.

### 12.4 Outreach drafting

`draftOutreach` lives at `src/agent/outreach.ts` and is a one-shot `generateObject` call — no agent loop, no exploratory tools. The function reads the prospect record from Airtable and the user preferences from `src/memory/preferences.md` in code beforehand (no loop means no tool calls), then passes both in as context. Persistence — the Airtable `Outreach` row, written via the MCP client from `src/tools/airtable.ts` — happens in code after `generateObject` returns.

### 12.5 Tool descriptions

Each hand-wrapped tool has a `description` written for the Brain — it's how the LLM decides whether to call it. State what the tool does and when to use it. MCP-discovered descriptions come from the server and are accepted as-is.

## 13. Storage — Airtable
<!-- The Airtable schema for the Prospects and Outreach tables, plus setup mistakes that break the build. -->

Two linked tables in a single base. The PRD is the source of truth for the schema; the base is provisioned from §13.1–§13.3 by Claude Code in a one-off session, not by a committed setup script. Schema mistakes that break the build are listed in §13.4.

### 13.1 Base

- **Base name:** `Sales Prospecting`
- **Tables:** `Prospects`, `Outreach` (linked)

### 13.2 `Prospects` table

| Field | Type | Options | Notes |
|---|---|---|---|
| `domain` | Single line text | — | **Primary field**. Canonical key (lowercase, no TLD). |
| `companyName` | Single line text | — | Display name. |
| `overview` | Long text | Rich text OFF | 1–2 paragraphs. |
| `signals` | Long text | Rich text ON | Bulleted markdown — one bullet per signal. |
| `leadScore` | Number | Integer, 1–100 | |
| `scoreReasoning` | Long text | Rich text OFF | |
| `suggestedAngle` | Long text | Rich text OFF | |
| `status` | Single select | Options: `researched`, `contacted`, `replied`, `dead` | Defaults to `researched` on insert. |
| `lastResearched` | Date | **Include time ON** (24-hour) | ISO datetime. |
| `outreachDrafts` | Linked record → `Outreach` | — | Auto-populated when an outreach record links here. |

### 13.3 `Outreach` table

| Field | Type | Options | Notes |
|---|---|---|---|
| `subjectLine` | Single line text | — | **Primary field.** Chosen as primary so the `outreachDrafts` linked column on `Prospects` displays subject lines (useful) rather than the prospect domain echoed back (circular). |
| `prospect` | Linked record → `Prospects` | — | Principal link back to `Prospects`. Not the table's primary field — see `subjectLine` above. |
| `emailBody` | Long text | Rich text OFF | |
| `angleReasoning` | Long text | Rich text OFF | Why this angle for this prospect. |
| `status` | Single select | Options: `draft`, `sent`, `replied` | Defaults to `draft`. |
| `createdAt` | Date | **Include time ON** | ISO datetime. |

### 13.4 Common setup mistakes that break the build

Grouped by category. Each item names the wrong choice and the resulting failure.

**(a) Airtable schema setup — field types and primary fields:**

- `lastResearched` or `createdAt` created as Date-only → datetime writes fail.
- `status` Single Select with no options pre-configured → writes fail.
- `signals` field saved as freeform JSON instead of a markdown bullet list → renders ugly in Airtable.
- `domain` not used as the primary field on `Prospects` → upserts can create duplicates.
- `subjectLine` not used as the primary field on `Outreach` (e.g. `prospect` set as primary instead) → the `outreachDrafts` linked column on `Prospects` displays the prospect's own domain echoed back rather than subject lines.

**(b) Schema-validation rules — load-bearing fields:**

- `domain` silently derived inside the structurer, or `domain` / `lastResearched` marked `.optional()` on `ProspectSchema` → both forbidden by §7.4 (silent fallbacks for load-bearing fields).

**(c) MCP tool-name and discovery mistakes:**

- `upsertProspect` treated as a tool name discoverable from `client.tools()` → it isn't. It's a **local wrapper** in `src/tools/airtable.ts` that composes Airtable MCP's CRUD primitives (`list_records_for_table` / `create_records_for_table` / `update_records_for_table` / `delete_records_for_table`, pinned by name in §12.3) into an upsert keyed on `domain`. Hard-coding `upsertProspect` as an MCP tool name will fail tool-discovery and surface as an opaque "tool not found" error.
- **Fuzzy regex tool lookup** (e.g. `Object.keys(tools).find(n => /create.records?/i.test(n))`) → matches `create_record_comment` before `create_records_for_table`. New-prospect creation routes to the comment tool and the validation throws on unknown fields. Use exact-name lookup per §12.3.

**(d) MCP call-shape mistakes — envelope, filters, payload keys:**

- **MCP result returned to caller without inspecting `isError`** → calls that fail with `isError: true` look like success to a `try/catch`, producing silent no-op writes and accumulating stale rows from "successful" test cleanup that never ran. Every Airtable call must unwrap the envelope per §12.3:

  ```ts
  // Wrong — caller sees an object that "succeeded"
  return await tools.create_records_for_table.execute(args, opts);

  // Right — envelope unwrap
  const result = await tools.create_records_for_table.execute(args, opts);
  if (result.isError) throw new Error(result.content[0].text);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
  ```

  The §16.1 persistence tests must also read back from Airtable, not just inspect the locally-returned `prospect` object — otherwise a write that fails silently still leaves the suite green.

- **`filterByFormula` passed to `list_records_for_table`** → silently dropped (returns `isError: false`), the list returns all rows, and a write keyed off `records[0]` corrupts whichever record sorted first. Use the structured `filters` param per §12.3:

  ```ts
  // Wrong — silently dropped, returns all rows
  { baseId, tableId, filterByFormula: `{domain} = "${prospect.domain}"` }

  // Right — structured filter, keyed by field ID
  {
    baseId,
    tableId,
    filters: { operands: [{ operator: '=', operands: [domainFieldId, prospect.domain] }] },
  }
  ```

- **Linked-record write to `create_records_for_table` without `typecast: true`** → the row is created, `isError` is `false`, but the linked field is silently null-coerced and the link is empty. Same failure shape as the dropped-filter case above (write looks successful, field silently not applied). The §12.3 envelope unwrap cannot catch this because `isError` stays `false`; the only signal is the §16.1 id-match assertion failing later. Always pass `typecast: true` on `create_records_for_table` calls that include a linked-record field, and pass the linked value as `[recId]` (array of bare `rec…` strings — the array-of-`{id}`-objects form is rejected with `Value "[object Object]" is not a valid record ID.`):

  ```ts
  // Wrong — silently null-coerces the linked field, link stays empty
  await tools.create_records_for_table.execute({
    baseId, tableId,
    records: [{ fields: { [prospectFieldId]: [prospectId], ... } }],
  });

  // Right — typecast: true coerces the string id into the linked cell value
  await tools.create_records_for_table.execute({
    baseId, tableId,
    records: [{ fields: { [prospectFieldId]: [prospectId], ... } }],
    typecast: true,
  });
  ```

- **Reading `r.fields[name]` from `list_records_for_table` results** → returns `undefined` for every field. The current MCP returns values on `r.cellValuesByFieldId[fldXXX]`. Discover the field-name → field-ID map once via `list_tables_for_base` per §12.3.
- **Passing field names (not `fldXXX` IDs) inside `records: [{ fields: {...} }]`, or passing `tableIdOrName: 'Prospects'` instead of `tableId: 'tbl…'`** → write rejected with `isError: true` (thrown loudly per the unwrap rule). Resolve all IDs via `list_tables_for_base` and reuse them for the lifetime of the client.

**(e) Test cleanup order:**

- **Test cleanup deletes the prospect before its linked Outreach rows** → Airtable does not cascade-delete linked records, so the Outreach rows orphan and accumulate across runs. Use `deleteOutreachByProspect` first, then `deleteProspectByDomain` (per §12.3). The §16.1 outreach assertions stay green even as orphans accumulate, so the leak is silent until the base hits a row limit.

**(f) Naming drift between PRD and code:**

- **PRD wins on names.** If a helper name, table name, field name, or any other identifier in the PRD differs from what existing code uses (singular vs plural, snake vs camel, renamed wrapper, etc.), treat the code as the drift, not the PRD. Update the code to match the PRD; or — if the code is right and the PRD is wrong — edit the PRD first, then bring the code into alignment. Do **not** silently follow the existing code "to avoid mid-feature renames" — that papers over the drift and embeds it deeper, and the next provisioning run repeats the wrong pick.

## 14. Configuration & secrets
<!-- What goes in secrets, what goes in code, and what to do if a token leaks. -->

The project has exactly **four secrets** and **two project constants**. They live in different places by design.

### 14.1 Secrets (four — user-specific, never committed)

```
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...                    # copy from the Airtable base URL
```

The workshop uses **GitHub Codespaces secrets** as the primary path — set once per user at `github.com/settings/codespaces`, injected as environment variables on every Codespace boot, no file ever exists on disk. For local development outside Codespaces, the same four values go in a `.env` file in the project root. `.env` is in `.gitignore`. `.env.example` is committed with placeholders so contributors know what to set.

Each module reads the env vars it needs directly via `process.env`. There is no central env-validation module — for a four-key POC, a missing key surfaces a clear error at first use, which is enough.

If a token leaks (commits, logs, screenshots, shared Codespaces), rotate immediately.

### 14.2 Project constants (two — same for every user, live in code)

`MODEL` and `MAX_SEARCH_RESULTS` are **not** env vars. They're project defaults — the same for every student running this workshop — so they belong in code, not config. Inline them at the single call site where each is used:

```ts
// src/agent/research.ts
model: anthropic('claude-haiku-4-5'),
```

```ts
// src/tools/tavily.ts
const MAX_RESULTS = 5;
```

To swap models (e.g. Haiku → Sonnet for higher quality) or change the search cap, edit the constant directly. No env var indirection — these aren't things that vary per user or per environment, so treating them as config is a code smell that misleads students into thinking they need to be set up.

## 15. Error handling
<!-- What the agent does when something goes wrong — search empty, API down, env missing, write failure. -->

| Condition | Agent behavior |
|---|---|
| `searchWeb` returns no useful results | Try alternate queries up to 3×. If still empty, lower the score and reflect it in `scoreReasoning`. |
| Tavily 4xx/5xx or rate limit | Surface clearly; suggest checking the Tavily dashboard. |
| Anthropic rate limit | Surface clearly; suggest waiting or switching to a smaller model. |
| Airtable write fails (any thrown error from `upsertProspect`, including MCP `isError: true` envelopes unwrapped per §12.3) | Surface error; print the prospect to terminal as a fallback so the work isn't lost. |
| Schema validation fails on agent output | Retry up to 2 times. If still failing, error with diagnostics. |
| `outreach` called with no prior research | Error: `Research <Company> first. No prospect record found.` |
| Any required env var missing | CLI prints a setup instruction and exits cleanly. Tests log a visible `console.warn` naming the missing var and skip — never silently. See §16.2. |

## 16. Testing strategy
<!-- How we test: TDD with real services, no mocks. The required coverage, the runner contract, and what 'green' really means. -->

- **TDD throughout.** Tests are written before the implementation; every test suite starts red and ends green.
- **Real services, not mocks.** Tavily tests hit the real Tavily API. Airtable tests hit the real base. Memory tests hit the real local JSON file. Mocks pass when the real thing fails — and integration drift between code and service is the bug class we care most about.
- **Skip cleanly when keys missing — but loudly.** No hard-fails on test runs without env vars, but skips must be observable: a `console.warn` at suite start naming the missing var. A green run with all integration tests silently skipped is not an acceptable signal — it's a lie. The runner contract that enforces this lives in §16.2.
- **Tests clean up after themselves.** Tests that write to Airtable delete their rows via `deleteProspectByDomain` and `deleteOutreachByProspect` from `src/tools/airtable.ts` (per §12.3) — not by re-discovering MCP tool names inline. **Order matters:** call `deleteOutreachByProspect` before `deleteProspectByDomain`, since deleting the prospect first leaves orphan Outreach rows the linked-field lookup can no longer locate. Tests that write to memory restore the file.
- **Cleanups are wrapped independently.** Each teardown operation (delete a row, restore a file) runs in its own `try/catch` with `console.warn` on failure. A failing cleanup must not short-circuit subsequent cleanups, and must not throw to mask the actual test result. Cleanups log; assertions decide pass/fail.
- **Cost control.** Tavily and Anthropic rate limits and per-call costs are real. The project constants `claude-haiku-4-5` (in `src/agent/research.ts`) and `MAX_RESULTS = 5` (in `src/tools/tavily.ts`) — see §14.2 — keep iteration cheap; lower further in code if test runs become expensive.
- **§16.1 is the canonical test spec.** Every test asserts a bullet from §16.1; behaviors are not restated elsewhere. If the implementation needs a test that isn't in §16.1, update §16.1 first — that keeps the PRD authoritative and prevents the spec and the test suite from drifting.

### 16.1 Required test coverage by feature

This section is the test specification. Each feature heading lists the behaviors its test suite must assert. Anything not on this list is out of scope for v1.

#### Tavily web search — `searchWeb`

**Description**

- Not unit-tested. Description quality is judgment-based and verified at the agent layer — when the Brain comes online, the real check is whether it picks `searchWeb` for prospecting queries.

**Parameters**

- `query` accepts a string (implicit in the non-empty-result test below). **(searchWeb build)**
- `recencyDays` defaults to 90 when the caller doesn't specify. Tests must assert this default. **(searchWeb build)**

**Function (`execute`)**

- Calling `searchWeb` against the real Tavily API returns a non-empty result list for a normal query. **(searchWeb build)**
- Each result has exactly the fields `{ title, url, snippet, publishedDate }` — no additional fields leaking from Tavily's raw response. **(searchWeb build)**
- Every returned result has a parseable `publishedDate` within the requested `recencyDays` window. Results without a parseable date are excluded. **(searchWeb build)**
- Results from domains in the blocklist are excluded. The blocklist is a `const` array at the top of `src/tools/tavily.ts` and **must include at minimum**: `tipranks.com`, `seekingalpha.com`, `fool.com`, `benzinga.com` — SEO-spam finance listicles that surface for any company-name query and contribute zero support-fit signal. Add at least one more domain so the suite ships with 5+ starter entries. The list is **not** extracted into its own module — it's small, has one consumer, and inlining keeps the search tool self-contained. **(searchWeb build)**
- Required Tavily request body: pass `topic: 'news'` in the Tavily REST request. Tavily only reliably populates `published_date` on news-topic searches; the default `topic: 'general'` returns results with `published_date` null or missing, every result is dropped by the parseable-date filter above, and `searchWeb` returns an empty array. The symptom is the "non-empty result list" test failing despite a working fetch, status 200, and a populated `results` array. `topic: 'news'` is also the right fit for this tool's purpose (press releases, funding announcements, hiring news — not generic web pages). **(searchWeb build)**

**Boundary handling (env)**

- When `TAVILY_API_KEY` is missing, the tool throws a clear, actionable error — not a network/parse error or silent failure. This test runs unconditionally per §16.2 (lives in its own top-level describe, never inside `skipIf`). **(searchWeb build)**
- The suite skips cleanly when `TAVILY_API_KEY` is unset — real-API tests only. The missing-env test above always runs. **(searchWeb build)**

#### Airtable MCP integration

- The agent connects to the Airtable MCP server using `AIRTABLE_API_KEY`. **(Airtable connector)**
- The discovered tool list contains the exact names §12.3 pins: `list_tables_for_base`, `list_records_for_table`, `create_records_for_table`, `update_records_for_table`, `delete_records_for_table`. Asserting exact names (not "any write tool") is the canary that catches MCP-side renames before they corrupt data — without it, fuzzy lookup picks the wrong tool (e.g. `create_record_comment` matched ahead of `create_records_for_table`) and writes go to the wrong place. When this test goes red, update §12.3 + §13.4 together rather than loosening the assertion. **(Airtable connector)**
- The connection closes cleanly via `close()`. **(Airtable connector)**
- When `AIRTABLE_API_KEY` or `AIRTABLE_BASE_ID` is missing, the connection setup throws a clear, actionable error naming the missing var — not an opaque MCP/transport failure. This test runs unconditionally per §16.2 (lives in its own top-level describe, never inside `skipIf`). **(Airtable connector)**
- The suite skips cleanly when `AIRTABLE_API_KEY` or `AIRTABLE_BASE_ID` are unset — real-API tests only. The missing-env test above always runs. **(Airtable connector)**

(No business logic of our own to test here — this is purely a runtime-path verification of the MCP client.)

#### Company research — `researchCompany`

Bullets are tagged by the build stage that introduces them. A bullet is *only* spec-bearing for the stage it tags; earlier stages assert the subset above the line. "All bullets at once" is the `(structurer + persistence)` acceptance state, not the `(researchCompany seed)` acceptance state. Prompts that reference §16.1 should pair the section reference with the corresponding stage tag, so a single prompt does not pull later-stage bullets forward into an earlier build.

- `researchCompany(companyName)` is callable and returns a non-empty response when given a company name. **(researchCompany seed)**
- During a `researchCompany` run, the agent invokes `searchWeb` at least once (verified via `steps.length > 1` and tool-call inspection). **(search wiring)**
- `researchCompany(companyName)` returns an object matching `ProspectSchema` (§7.1). **(structurer + persistence)**
- `leadScore` is an integer in [1, 100]. **(structurer + persistence)**
- `signals` is non-empty; every element's `strength` ∈ {`strong`, `moderate`, `weak`}. **(structurer + persistence)**
- The returned shape is compatible with the `Prospects` Airtable schema (§13.2). **(structurer + persistence)**
- `domain` is a non-empty string in canonical form: lowercase, no protocol, no TLD (e.g. `'stripe'` — not `'Stripe.com'`, `'https://stripe.com'`, `undefined`, or `''`). Required because `domain` is the primary field on `Prospects` (§13.2) — Airtable upserts key on it. Without this assertion the shape test passes with a missing or inconsistent domain and the upsert silently creates duplicate rows instead of updating an existing one. **(structurer + persistence)**
- `structureProspect(text, companyName)` is exported from `src/agent/research.ts` and importable directly. When called with analysis text and a company name, the returned object **does not contain** `domain` or `lastResearched` keys — not as `undefined`, not as `''`, not as derived values. This is the negative test for §7.4: it pins the structurer to the `.omit()` contract and prevents a future "helpful" silent fallback from re-introducing the field inside the structurer. **(structurer + persistence)**
- After `researchCompany` returns, the `Prospects` table contains **exactly one** row with `domain == prospect.domain`, and that row's `leadScore`, `companyName`, and `lastResearched` match the values in the returned `prospect`. Verified by listing via `list_records_for_table` with the structured `filters` param (per §12.3); per-row values are read from `r.cellValuesByFieldId[fldXXX]` (not `r.fields[name]` — that returns `undefined` post-MCP-rename and would let this assertion silently pass on every field). The §12.3 envelope unwrap catches `isError: true`; this assertion catches the harder class — "MCP accepted my call but did something else" (silently dropped param, fuzzy tool routing, write to the wrong record). Without it, an `upsertProspect` implementation with silent-failure or wrong-row-corruption bugs would still pass the suite. **(structurer + persistence)**
- The `(researchCompany seed)` suite skips cleanly when `ANTHROPIC_API_KEY` is unset. **(researchCompany seed)**
- The `(search wiring)` suite additionally skips when `TAVILY_API_KEY` is unset (the agent now invokes `searchWeb`, which hits Tavily). **(search wiring)**
- The `(structurer + persistence)` suite additionally skips when `AIRTABLE_API_KEY` or `AIRTABLE_BASE_ID` is unset (the run now upserts to Airtable). **(structurer + persistence)**

**`(researchCompany seed)` scope boundary.** The `(researchCompany seed)` step proves the Brain reaches the LLM with `generateText` and a plain prompt; tools, system prompt, and structured output all layer on later. Do not reach for `generateObject` or import `ProspectSchema` to satisfy the seed test — that's the `(structurer + persistence)` move.

**`(structurer + persistence)` contract — the `generateObject` prompt for `structureProspect`.** The prompt is pinned verbatim in §12.3. Paraphrasing causes extraction drift: different wording produces different field shapes for the same analysis. If the §12.3 string needs to change, edit the PRD first, then bring the implementation into alignment.

#### Preferences memory — `listPreferences` / `addPreference` / `removePreference`

(Tests run against the real `src/memory/preferences.md` file.)

- `listPreferences()` returns the file contents as a string, or `""` when the file does not yet exist. **(preferences memory)**
- `addPreference(text)` appends a new bullet to the file. Creates the file with a `# Preferences` header on first write. Round-trips through `listPreferences`. **(preferences memory)**
- `addPreference(text)` is idempotent on exact-match — adding the same preference twice does not duplicate. **(preferences memory)**
- `removePreference(text)` removes a matching bullet from the file. Match is case-insensitive substring; only the first match is removed. **(preferences memory)**
- Tests restore the file (or delete the test-created one) after running. **(preferences memory)**

#### Preference-driven agent behavior

- A `researchCompany` run begins with a `listPreferences` tool call (verified via `steps` inspection). The Brain reads preferences first, every run. **(preferences wiring)**
- After `addPreference` with text containing a paraphrase-resistant token (specific numerals or proper nouns — e.g. *"For shipping companies, lead with multilingual deflection across Cantonese and Bahasa"*), running `researchCompany` on a logistics company (e.g. UPS, FedEx, DHL) produces a `suggestedAngle` whose text contains that token. **Do not** match on generic value-prop words like `'multilingual'` or `'localized'` — the LLM can produce those independently of the preference, which would satisfy the assertion without proving the preference was applied. **(structurer + persistence)**
- A `researchCompany` run with no matching preferences does not invent one — the suggested angle is shaped only by the prospect data, not by hallucinated rules. **(structurer + persistence)**
- A user message containing stateful feedback ("for shipping companies, lead with X") triggers an `addPreference` tool call within the same `researchCompany` run; the new preference is observable in `preferences.md` after the run completes. **(preferences wiring)**

#### Outreach drafting — `draftOutreach`

- `draftOutreach(domain)` returns an object matching `OutreachSchema` (§11.1). **(outreach drafting)**
- `subjectLine.length ≤ 80`. **(outreach drafting)**
- `emailBody` references at least two specific signals from the prospect record. Verified by seeding the test prospect with two signals whose descriptions contain paraphrase-resistant tokens — specific numerals and proper nouns only (e.g., `'47'`, `'Singapore'`, `'Japanese'`) — and asserting at least one such token from each signal appears in `emailBody`. **Do not** use generic value-prop vocabulary (`'multilingual'`, `'localized'`, `'customer experience'`, `'open roles'`) as match tokens; an LLM can drop those in without referencing the prospect, which would satisfy the assertion without proving the LLM read the seed. **Match tokens must appear ONLY inside `signals[].description`** — never in `suggestedAngle`, `scoreReasoning`, `overview`, or `companyName`. Reading any single non-signal field of the seeded prospect must not satisfy the assertion. Why: the model is most likely to anchor on `suggestedAngle` (the literal "how to open" hint) and never read the signals array; if the same tokens were leaked there, the assertion would pass without the model ever consulting `signals`. Construct the seed so `suggestedAngle`/`scoreReasoning`/`overview` describe the dynamic in non-matching wording (e.g., "new APAC launch and rapid regional hiring" instead of "Japanese launch and Singapore hiring"). **(outreach drafting)**
- Calling `draftOutreach` for a domain with no prior prospect record errors with `Research <Company> first.` (per §11.2). **(outreach drafting)**
- After `draftOutreach`, the Airtable `Outreach` table contains a row whose `prospect` link points to the seeded prospect's record id. Verified by **id match across both tables** via the read primitives in §12.3: (1) call `getProspectIdByDomain(client, TEST_DOMAIN)` and capture the returned `rec…` id; (2) call `listOutreachByProspectId(client, prospectId)`; (3) assert the returned array is non-empty. **Do not** use `deleteOutreachByProspect`'s return count as the assertion — that conflates verification with cleanup, and a buggy delete helper (dropped link filter, fuzzy match, off-by-one) would satisfy the verification it was supposed to be tested by. Verifier and cleaner are different code paths per §12.3. **(outreach drafting)**
- When `ANTHROPIC_API_KEY` is missing, `draftOutreach` throws a clear, actionable error mentioning `ANTHROPIC_API_KEY` — before attempting any Airtable lookup (per §11.2). This test runs unconditionally per §16.2 (lives in its own top-level describe, never inside `skipIf`). **(outreach drafting)**
- The suite skips cleanly when `ANTHROPIC_API_KEY`, `AIRTABLE_API_KEY`, or `AIRTABLE_BASE_ID` is unset — real-API tests only. The missing-env test above always runs. **(outreach drafting)**

### 16.2 Test execution contract

The runner has three jobs beyond running tests: load the same env as runtime, make every skip visible, and never let "green" mean "skipped." This section is the contract — `package.json`, the test files, and CI all answer to it.

**Env loading — vitest sees the same env as runtime.**

`process.env.TAVILY_API_KEY` (and the other keys in §14) must be populated from `.env` before vitest starts, so real-API tests actually exercise the real API. Use Node's native flag in the `test` script:

```json
"scripts": {
  "test": "tsc --noEmit && node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs"
}
```

The `-if-exists` variant is intentional: CI without a `.env` file still runs (and integration tests skip with a warning); local with a populated `.env` runs the real-API suites. Plain `vitest` without this wiring will see `process.env.TAVILY_API_KEY` as `undefined` even with `.env` present in the repo, because Node does not auto-load `.env` files. The PRD bans `dotenv` (§4.2) — Node's flag replaces it.

**Type-check is part of green.** Vitest does not type-check — it transforms via esbuild and ignores type errors entirely. Without `tsc --noEmit` chained ahead, type errors accumulate silently and surface only when someone runs `tsc` by hand. The `ai@^5` `tool()` return-type narrowing case (§4.2) is the canonical example — vitest happily passes while `await searchWeb.execute!(...)` is typed as `T[] | AsyncIterable<T[]>`. The `&&` ordering is intentional: types fail first (cheap, fast), then real-API tests run (slow, costly). A type error short-circuits before any Anthropic or Tavily calls fire.

**`npm test` is the only supported entry point.** `npx vitest` (or any vitest invocation that bypasses the `test` script) skips Node's env-file flag and will see env vars as undefined. The observable-skip rule below catches this — the suite warns loudly rather than producing a false green — but the test still won't actually run. There is intentionally no `vitest.config.ts` setup-file workaround that loads `.env` from inside vitest: loading `.env` is the npm script's job, not the runner's, so env-loading remains visible rather than hidden in a config file. If you find yourself reaching for `npx vitest`, fix the npm script or your `.env` instead of bypassing.

Quick verification anyone can run before trusting a green build:

```bash
node --env-file-if-exists=.env -e 'console.log(!!process.env.TAVILY_API_KEY)'
```

If that prints `false` in the same shell `npm test` runs in, the env-loading contract is broken regardless of what vitest reports.

**Test timeouts — 60s per test.**

Set the per-test timeout via a minimal `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
```

Timeouts are the only thing `vitest.config.ts` does on this project. Env loading stays in the npm script so the env-loading contract lives in one place rather than scattered between a script and a config file.

**Hook timeouts — real-API setup needs more than the 10s default.**

`beforeAll` and `afterAll` hooks that run real-API work (seeding rows, calling `researchCompany` once to share its result across a suite, deleting linked records) routinely exceed vitest's 10-second default hook budget. The `(structurer + persistence)` `beforeAll` is the canonical case — it runs the full `researchCompany` pipeline (loop → structurer → upsert) and easily hits 60s.

Pass the timeout as a per-hook argument, not as a global config knob. Vitest's `beforeAll(fn, timeout)` / `afterAll(fn, timeout)` signatures accept a per-hook timeout — keep the budget visible at the call-site:

```ts
beforeAll(async () => { /* researchCompany(...) etc. */ }, 120_000);
afterAll(async () => { /* deleteProspectByDomain(...) */ }, 60_000);
```

`hookTimeout` in `vitest.config.ts` is intentionally not added — the same hide-behavior-in-config concern that motivates the single-knob `testTimeout` rule applies. Hook budgets are local to the suite that needs them.

Default budgets: `120_000` for setup hooks that run `researchCompany` end-to-end; `60_000` for cleanup hooks that only call MCP CRUD primitives. Ceilings, not targets — fast hooks still finish in milliseconds.

**Observable skips — silent skip is a defect.**

Any test suite that skips because an env var is missing must `console.warn` at the top of the file (or in a `beforeAll` hook) naming the missing var:

```ts
if (!process.env.TAVILY_API_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — Tavily real-API suite skipped');
}
```

The phrase "skips cleanly" everywhere else in §16 (per-feature bullets, error handling) is defined here: it means warns-and-skips, not silently skips. A reviewer or CI dashboard scanning output must be able to see, at a glance, which suites did not run.

**Missing-env tests run unconditionally.**

This rule exists because: an assertion that should fire *only when the env var is missing*, but lives inside a block that *also skips when the env var is missing*, passes by being skipped — and the missing-env contract goes unverified. Observable skips (above) catch silent skips of real-API suites, but a missing-env assertion that lives inside `skipIf(!HAS_KEY)` looks like a passing test in the count — there is nothing for the observable-skip rule to flag.

The structural fix:

- **Missing-env assertions never sit inside `describe.skipIf(!HAS_KEY)`.** They live in their own top-level describe, separate from the real-API suite for the same feature.
- **Block name convention: `<feature> — missing env (always runs)`.** The "always runs" suffix is visible at the suite level in vitest output, not buried inside an `it` description, so a reviewer scanning the output can confirm the missing-env contract was actually exercised.
- **Use vitest-native env stubbing.** `vi.stubEnv(NAME, '')` inside the test, with `afterEach(() => vi.unstubAllEnvs())` to auto-restore. Do not use `delete process.env.X` — its restoration semantics are runner-dependent and leave downstream tests order-sensitive.

Canonical pattern:

```ts
describe('Tavily — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(searchWeb('q')).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe.skipIf(!process.env.TAVILY_API_KEY)('Tavily — real API', () => {
  // …real-API tests here. These skip when the key is unset (with a console.warn per the observable-skip rule).
});
```

The §16.1 per-feature bullets disambiguate which tests are subject to `skipIf` and which aren't: bullets tagged "this test runs unconditionally per §16.2" go in the always-runs describe; the rest go in the real-API describe that skips with a warning.

**Definition of green for TDD.**

A passing TDD cycle requires the test that was red to actually execute against the real path. A skipped test is **not green** — it is unverified. When implementing red → green:

- Read the vitest output, not just the exit code. `x passed, y skipped` with `y > 0` on the suite you just implemented is a **yellow flag**, not green.
- If the suite you intended to turn green is in the skip count, the env-loading contract above is broken (or the key is genuinely missing) — fix that before claiming the cycle closed.
- Coverage of a §16.1 bullet requires the asserting test to have *run*. Skipped tests do not satisfy §16.1.

This rule keeps the test suite an honest signal of correctness instead of a rubber stamp. Without it, "all green" can mean "all skipped" — a false signal.

### 16.3 The test is the spec for the change

In a no-mocks project, the integration test is the TDD layer — there is no unit-test scaffold to lean on. If a test would have failed before an edit and passes after, that test **is** the spec for that edit, even when the change is "just wiring."

- **A test that goes from red to green is the spec for that edit.** When `/tdd` is red, fix the code, not the test. The test pins the behavior; the implementation has to match. An assertion that turns out to be wrong is edited deliberately, in its own change, and surfaced — never silently mutated to make `/tdd` green.
- **"Just wiring" tests are spec tests.** The §16.1 bullet tagged **(search wiring)** — "the agent invokes `searchWeb` at least once during `researchCompany`, verified via `steps.length > 1` and tool-call inspection" — is the canonical example. Passing `searchWeb` into the `tools` map looks like a one-line edit, but the test exists so the wiring cannot silently regress when someone later refactors the tools map. It is load-bearing, not ceremonial.
- **§16.1 stage tags identify which bullet is the spec test at which stage.** A bullet tagged **(search wiring)** is the spec test for the search-wiring edit; a bullet tagged **(structurer + persistence)** is the spec test for the structurer-and-persistence edit. Prompts that drive an implementation should cite the §16.1 bullet for the stage being built — not "all §16.1 bullets" — so the implementation cannot pull future-stage behavior forward.

§16.1 names every test the suite must contain. §16.3 names which one fires for any given change.

## 17. Acceptance criteria
<!-- The checklist that defines 'done' for v1 — if every item is true, we ship. -->

The build is "done" for v1 when **all of the following are true** (invocation is via Claude Code in plain English — see §5):

1. Asking Claude Code to "research Stripe" produces a valid `Prospect` and writes it to Airtable's `Prospects` table.
2. Telling the agent "for shipping companies, lead with 24/7 multilingual deflection" results in that bullet being appended to `src/memory/preferences.md`. The streaming output shows an `addPreference` tool call and a `Saved preference: <text>` acknowledgment.
3. After the preference is saved, researching a logistics company (e.g. UPS) produces a `suggestedAngle` whose text references multilingual support. The streaming output shows a `listPreferences` tool call and a narrated "Applying saved preference" line.
4. Asking "list my preferences" returns the contents of `preferences.md` (or "no preferences saved" if the file is empty/missing).
5. Asking to remove a preference ("forget the multilingual rule") removes that bullet from `preferences.md`.
6. Asking Claude Code to "draft outreach for Stripe" produces a valid `Outreach` and writes a linked row to the `Outreach` table.
7. Asking to "draft outreach for UnknownCorp" (no prior research) errors cleanly with `Research UnknownCorp first.`
8. Asking to "research Stripe and then draft outreach" runs both in sequence.
9. All §16.1 test suites pass against real services (run via `/tdd` or `npm test`).
10. The `Prospects` table sorts by `leadScore` and reads as a usable pipeline.
11. The `Outreach` table shows linked emails for each researched prospect.

**Not in v1.** Asking again on the same company creates a fresh re-research and overwrites the row (no skip, no dedup) — see §3.
