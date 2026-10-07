import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createOutreach, getAirtableMcp, getProspectByDomain } from '../tools/airtable.ts';

export const OutreachSchema = z.object({
  subjectLine: z.string().max(80),
  emailBody: z.string(),
  angleReasoning: z.string(),
});

export type Outreach = z.infer<typeof OutreachSchema>;

const OUTREACH_PROMPT_PATH = fileURLToPath(new URL('./prompts/outreach.md', import.meta.url));
const PREFS_PATH = fileURLToPath(new URL('../memory/preferences.md', import.meta.url));

export async function draftOutreach(domain: string): Promise<Outreach> {
  // §11.2: env validation first — before Airtable, prompt load, or model call.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) — get a key at https://console.anthropic.com.',
    );
  }

  const client = await getAirtableMcp();
  try {
    const prospect = await getProspectByDomain(client, domain);
    if (!prospect) throw new Error(`Research ${domain} first. No prospect record found.`);

    // Drafting reads memory in code, not via listPreferences (§12.4); a missing file means no preferences.
    const preferences = existsSync(PREFS_PATH) ? readFileSync(PREFS_PATH, 'utf-8') : '';
    const system = readFileSync(OUTREACH_PROMPT_PATH, 'utf-8');

    const { id: prospectId, ...record } = prospect;
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      schema: OutreachSchema,
      system,
      prompt: `Prospect record:\n${JSON.stringify(record, null, 2)}\n\nSaved preferences:\n${preferences || '(none)'}`,
    });
    const outreach = OutreachSchema.parse(object);

    await createOutreach(client, prospectId, outreach);
    console.log(`\nSubject: ${outreach.subjectLine}\n\n${outreach.emailBody}\n`);
    return outreach;
  } finally {
    try {
      await client.close();
    } catch (err) {
      console.warn('[outreach] Airtable MCP client close failed:', err);
    }
  }
}
