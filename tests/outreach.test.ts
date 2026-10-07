import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { draftOutreach } from '../src/agent/outreach.ts';
import { ProspectSchema, type Prospect } from '../src/agent/research.ts';
import {
  deleteOutreachByProspect,
  deleteProspectByDomain,
  getAirtableMcp,
  getProspectIdByDomain,
  listOutreachByProspectId,
  upsertProspect,
} from '../src/tools/airtable.ts';
import { z } from 'zod';

// §11.1 — mirrored here so the test asserts the schema independently of the implementation's export.
const OutreachSchema = z.object({
  subjectLine: z.string().max(80),
  emailBody: z.string(),
  angleReasoning: z.string(),
});

const TEST_DOMAIN = 'outreachtestco';
const UNKNOWN_DOMAIN = 'outreachunknownco';

// Match tokens live ONLY in signals[].description (§16.1). Every other field uses non-matching wording.
const TOKEN_A = '47'; // signal 1
const TOKEN_B = 'Singapore'; // signal 2
const SEED: Prospect = {
  companyName: 'Outreachtestco',
  domain: TEST_DOMAIN,
  overview: 'A mid-sized logistics software company expanding into new regions.',
  signals: [
    {
      name: 'Rapid support hiring',
      description: 'Has 47 open customer support roles posted across its careers page.',
      strength: 'strong',
    },
    {
      name: 'Regional expansion',
      description: 'Announced a new regional office in Singapore this quarter.',
      strength: 'moderate',
    },
  ],
  leadScore: 78,
  scoreReasoning: 'Fast-growing team with visible regional momentum and clear support-capacity pressure.',
  suggestedAngle: 'New regional launch and rapid team growth.',
  lastResearched: new Date().toISOString(),
};

function missing(...vars: string[]): string[] {
  return vars.filter((v) => !process.env[v]);
}

const REAL_MISSING = missing('ANTHROPIC_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID');
if (REAL_MISSING.length > 0) {
  console.warn(`[skip] ${REAL_MISSING.join(', ')} unset — draftOutreach real-API suite skipped`);
}

// §16.1: always runs, never inside skipIf (§16.2).
describe('Outreach — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error mentioning ANTHROPIC_API_KEY before any Airtable lookup', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    // Airtable creds are blanked too: if env validation ran after the lookup, the error would name AIRTABLE_*, not ANTHROPIC_API_KEY.
    vi.stubEnv('AIRTABLE_API_KEY', '');
    vi.stubEnv('AIRTABLE_BASE_ID', '');
    await expect(draftOutreach(TEST_DOMAIN)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe.skipIf(REAL_MISSING.length > 0)('Outreach — real API', () => {
  let outreach: Awaited<ReturnType<typeof draftOutreach>>;

  async function cleanup(domain: string): Promise<void> {
    const client = await getAirtableMcp();
    try {
      // Order matters: Outreach rows first, or the link lookup can no longer find them (§12.3).
      await deleteOutreachByProspect(client, domain);
      await deleteProspectByDomain(client, domain);
    } finally {
      await client.close();
    }
  }

  beforeAll(async () => {
    // Clear leftovers from an aborted earlier run so the seed is the only row.
    await cleanup(TEST_DOMAIN);
    const client = await getAirtableMcp();
    try {
      await upsertProspect(client, ProspectSchema.parse(SEED));
    } finally {
      await client.close();
    }
    outreach = await draftOutreach(TEST_DOMAIN);
  }, 120_000);

  afterAll(async () => {
    for (const domain of [TEST_DOMAIN, UNKNOWN_DOMAIN]) {
      try {
        await cleanup(domain);
      } catch (err) {
        console.warn(`[cleanup] removing "${domain}" rows failed:`, err);
      }
    }
  }, 60_000);

  it('returns an object matching OutreachSchema', () => {
    expect(OutreachSchema.safeParse(outreach).success).toBe(true);
  });

  it('subjectLine is at most 80 characters', () => {
    expect(outreach.subjectLine.length).toBeLessThanOrEqual(80);
  });

  it('emailBody references a specific token from each of two signals', () => {
    expect(outreach.emailBody).toContain(TOKEN_A);
    expect(outreach.emailBody).toContain(TOKEN_B);
  });

  it('errors with "Research <Company> first." for a domain with no prospect record', async () => {
    await expect(draftOutreach(UNKNOWN_DOMAIN)).rejects.toThrow(/Research .+ first\./);
  });

  it('persists an Outreach row linked to the seeded prospect (id match across both tables)', async () => {
    const client = await getAirtableMcp();
    try {
      const prospectId = await getProspectIdByDomain(client, TEST_DOMAIN);
      expect(prospectId).toMatch(/^rec/);
      const outreachIds = await listOutreachByProspectId(client, prospectId!);
      expect(outreachIds.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });
});
