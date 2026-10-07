import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProspectSchema, researchCompany, structureProspect } from '../../src/agent/research.ts';
import { deleteProspectByDomain, getAirtableMcp } from '../../src/tools/airtable.ts';

function missing(...vars: string[]): string[] {
  return vars.filter((v) => !process.env[v]);
}

const SEED_MISSING = missing('ANTHROPIC_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID');
const WIRING_MISSING = missing('ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID');
const STRUCTURER_MISSING = missing('ANTHROPIC_API_KEY');

if (SEED_MISSING.length > 0) {
  console.warn(`[skip] ${SEED_MISSING.join(', ')} unset — researchCompany real-API suite skipped`);
}
if (WIRING_MISSING.length > 0) {
  console.warn(
    `[skip] ${WIRING_MISSING.join(', ')} unset — researchCompany search/preferences-wiring and structurer + persistence suites skipped`,
  );
}
if (STRUCTURER_MISSING.length > 0) {
  console.warn(`[skip] ${STRUCTURER_MISSING.join(', ')} unset — structureProspect suite skipped`);
}

const PREFS_PATH = fileURLToPath(new URL('../../src/memory/preferences.md', import.meta.url));

// §13.2 Prospects fields a researched prospect carries (`status` and `outreachDrafts` are Airtable-side).
const PROSPECT_KEYS = [
  'companyName',
  'domain',
  'lastResearched',
  'leadScore',
  'overview',
  'scoreReasoning',
  'signals',
  'suggestedAngle',
];

// Every researchCompany call upserts a Prospects row; collect each returned domain and delete it afterwards (§16).
async function deleteRows(domains: string[]): Promise<void> {
  const client = await getAirtableMcp();
  try {
    for (const domain of domains) {
      try {
        await deleteProspectByDomain(client, domain);
      } catch (err) {
        console.warn(`[cleanup] deleting Prospects row "${domain}" failed:`, err);
      }
    }
  } finally {
    try {
      await client.close();
    } catch (err) {
      console.warn('[cleanup] Airtable MCP client close failed:', err);
    }
  }
}

describe('researchCompany — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when ANTHROPIC_API_KEY is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(researchCompany('Stripe')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe.skipIf(SEED_MISSING.length > 0)('researchCompany — real API (researchCompany seed)', () => {
  const createdDomains: string[] = [];
  afterAll(() => deleteRows(createdDomains), 60_000);

  it('is callable and returns a non-empty response when given a company name', async () => {
    const { prospect } = await researchCompany('Stripe');
    createdDomains.push(prospect.domain);
    expect(typeof prospect.overview).toBe('string');
    expect(prospect.overview.trim().length).toBeGreaterThan(0);
  });
});

describe.skipIf(WIRING_MISSING.length > 0)('researchCompany — real API (search + preferences wiring)', () => {
  const createdDomains: string[] = [];

  // Real preferences.md: snapshot before, restore (or delete if it didn't exist) after.
  let originalPrefs: string | null;
  beforeEach(() => {
    originalPrefs = existsSync(PREFS_PATH) ? readFileSync(PREFS_PATH, 'utf8') : null;
  });
  afterEach(() => {
    if (originalPrefs === null) rmSync(PREFS_PATH, { force: true });
    else writeFileSync(PREFS_PATH, originalPrefs);
  });
  afterAll(() => deleteRows(createdDomains), 60_000);

  it('invokes searchWeb at least once during a run', async () => {
    const { prospect, steps } = await researchCompany('Stripe');
    createdDomains.push(prospect.domain);
    expect(steps.length).toBeGreaterThan(1);
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames).toContain('searchWeb');
  });

  it('begins with a listPreferences tool call', async () => {
    const { prospect, steps } = await researchCompany('Stripe');
    createdDomains.push(prospect.domain);
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames[0]).toBe('listPreferences');
  });

  it('saves stated feedback via addPreference within the same run', async () => {
    const token = 'Cantonese';
    const { prospect, steps } = await researchCompany(
      `UPS. For shipping companies, lead with multilingual deflection across ${token} and Bahasa`,
    );
    createdDomains.push(prospect.domain);
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames).toContain('addPreference');
    expect(readFileSync(PREFS_PATH, 'utf8')).toContain(token);
  });
});

describe.skipIf(STRUCTURER_MISSING.length > 0)('structureProspect — real API (structurer + persistence)', () => {
  const ANALYSIS = [
    'Acme Freight is a mid-sized logistics company serving e-commerce retailers across North America.',
    'Signals: 31 open customer-support roles posted in the last month (strong); announced a Series C in March (moderate).',
    'Likely handles high ticket volume during peak season. Score: 72 — promising, but no public AI tooling commitments.',
    'Suggested angle: open with peak-season ticket deflection.',
  ].join('\n');

  it('returns an object without domain or lastResearched keys (§7.4 omit contract)', async () => {
    const result = await structureProspect(ANALYSIS, 'Acme Freight');
    expect(result).not.toHaveProperty('domain');
    expect(result).not.toHaveProperty('lastResearched');
    expect(Object.keys(result)).not.toContain('domain');
    expect(Object.keys(result)).not.toContain('lastResearched');
  });
});

describe.skipIf(WIRING_MISSING.length > 0)('researchCompany — real API (structurer + persistence)', () => {
  const COMPANY = 'Stripe';
  type Run = Awaited<ReturnType<typeof researchCompany>>;
  let run: Run;

  beforeAll(async () => {
    run = await researchCompany(COMPANY);
  }, 120_000);

  afterAll(() => deleteRows(run ? [run.prospect.domain] : []), 60_000);

  it('returns an object matching ProspectSchema', () => {
    expect(ProspectSchema.safeParse(run.prospect).success).toBe(true);
  });

  it('has an integer leadScore in [1, 100]', () => {
    const { leadScore } = run.prospect;
    expect(Number.isInteger(leadScore)).toBe(true);
    expect(leadScore).toBeGreaterThanOrEqual(1);
    expect(leadScore).toBeLessThanOrEqual(100);
  });

  it('has non-empty signals, each with a strength in {strong, moderate, weak}', () => {
    const { signals } = run.prospect;
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(['strong', 'moderate', 'weak']).toContain(signal.strength);
    }
  });

  it('is compatible with the Prospects Airtable schema (§13.2)', () => {
    const p = run.prospect;
    expect(Object.keys(p).sort()).toEqual(PROSPECT_KEYS);
    for (const key of ['companyName', 'domain', 'overview', 'scoreReasoning', 'suggestedAngle'] as const) {
      expect(typeof p[key]).toBe('string');
      expect(p[key].trim().length).toBeGreaterThan(0);
    }
    expect(typeof p.leadScore).toBe('number');
    expect(Number.isNaN(Date.parse(p.lastResearched))).toBe(false);
    expect(Array.isArray(p.signals)).toBe(true);
  });

  it('has a canonical domain: lowercase, no protocol, no TLD', () => {
    const { domain } = run.prospect;
    expect(typeof domain).toBe('string');
    expect(domain.length).toBeGreaterThan(0);
    expect(domain).toBe(domain.toLowerCase());
    expect(domain).not.toMatch(/^[a-z]+:\/\//);
    expect(domain).toMatch(/^[a-z0-9]+$/);
    expect(domain).toBe('stripe');
  });

  describe('Airtable persistence', () => {
    type McpTool = { execute: (args: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown> };
    type Envelope = { isError?: boolean; content?: { text?: string }[]; structuredContent?: unknown };

    async function readRows(domain: string) {
      const client = await getAirtableMcp();
      try {
        const tools = (await client.tools()) as unknown as Record<string, McpTool>;
        const invoke = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
          const result = (await tools[name].execute(args, { toolCallId: 'verify', messages: [] })) as Envelope;
          if (result.isError) throw new Error(`${name} failed: ${result.content?.[0]?.text}`);
          return (result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? 'null')) as T;
        };

        const baseId = process.env.AIRTABLE_BASE_ID!;
        const { tables } = await invoke<{ tables: { id: string; name: string; fields: { id: string; name: string }[] }[] }>(
          'list_tables_for_base',
          { baseId },
        );
        const table = tables.find((t) => t.name === 'Prospects')!;
        const fieldId = (name: string) => table.fields.find((f) => f.name === name)!.id;
        const ids = { domain: fieldId('domain'), leadScore: fieldId('leadScore'), companyName: fieldId('companyName'), lastResearched: fieldId('lastResearched') };

        const { records } = await invoke<{ records: { id: string; cellValuesByFieldId: Record<string, unknown> }[] }>(
          'list_records_for_table',
          {
            baseId,
            tableId: table.id,
            fieldIds: Object.values(ids),
            filters: { operands: [{ operator: '=', operands: [ids.domain, domain] }] },
          },
        );
        return records.map((r) => ({
          leadScore: r.cellValuesByFieldId[ids.leadScore],
          companyName: r.cellValuesByFieldId[ids.companyName],
          lastResearched: r.cellValuesByFieldId[ids.lastResearched],
        }));
      } finally {
        await client.close();
      }
    }

    it('writes exactly one Prospects row for the domain, matching the returned prospect', async () => {
      const { prospect } = run;
      const rows = await readRows(prospect.domain);
      expect(rows).toHaveLength(1);
      expect(rows[0].leadScore).toBe(prospect.leadScore);
      expect(rows[0].companyName).toBe(prospect.companyName);
      // Airtable stores date-times at second precision, so compare instants to the second.
      const toSecond = (iso: unknown) => Math.floor(Date.parse(String(iso)) / 1000);
      expect(toSecond(rows[0].lastResearched)).toBe(toSecond(prospect.lastResearched));
    });
  });
});
