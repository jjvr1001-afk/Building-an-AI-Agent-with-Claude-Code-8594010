import { anthropic } from '@ai-sdk/anthropic';
import { generateObject, generateText, stepCountIs, type StepResult } from 'ai';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { getAirtableMcp, upsertProspect } from '../tools/airtable.ts';
import { searchWeb } from '../tools/tavily.ts';
import { addPreference, listPreferences, removePreference } from '../memory/preferences.ts';

export const ProspectSchema = z.object({
  companyName: z.string(),
  domain: z.string(), // canonical key — set by the caller, not the model (§7.4)
  overview: z.string(),
  signals: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        strength: z.enum(['strong', 'moderate', 'weak']),
      }),
    )
    .min(1),
  leadScore: z.number().int().min(1).max(100),
  scoreReasoning: z.string(),
  suggestedAngle: z.string(),
  lastResearched: z.string().datetime(),
});

export type Prospect = z.infer<typeof ProspectSchema>;

const StructuredProspectSchema = ProspectSchema.omit({ domain: true, lastResearched: true });

const MAX_STEPS = 8;
const MAX_SEARCHES_PER_STEP = 2;
const FINAL_STEP_NOTICE =
  'Searching is now closed. Do not say you will search again. Write your complete prospect analysis now, ' +
  'using only the evidence gathered above; where evidence is missing, say so and score accordingly.';

// The SDK has no per-step call cap, so count in execute and reset in prepareStep. Excess calls throw so the Brain
// sees an explicit refusal rather than an empty result it would read as "nothing found".
function buildTools() {
  let callsThisStep = 0;
  const limitedSearchWeb: typeof searchWeb = {
    ...searchWeb,
    execute: (input, options) => {
      if (++callsThisStep > MAX_SEARCHES_PER_STEP) {
        throw new Error(`searchWeb limit reached: at most ${MAX_SEARCHES_PER_STEP} searches per step.`);
      }
      return searchWeb.execute!(input, options);
    },
  };
  return { tools: { searchWeb: limitedSearchWeb, listPreferences, addPreference, removePreference }, resetStepCounter: () => void (callsThisStep = 0) };
}

type Tools = ReturnType<typeof buildTools>['tools'];

const BRAIN_PROMPT_PATH = new URL('./prompts/brain.md', import.meta.url);

// §6/§7.4: lowercase alphanumerics only; a domain input ("stripe.com", "https://www.stripe.com/") loses its TLD first.
function normalizeCompanyKey(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const host = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?([^\s/]+)\.[a-z]{2,}(?:\/\S*)?$/);
  return (host ? host[1] : trimmed).replace(/[^a-z0-9]/g, '');
}

// Returns a partial on purpose: `domain` and `lastResearched` are attached by the caller, never here (§7.4).
export async function structureProspect(analysisText: string, companyName: string) {
  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5'),
    schema: StructuredProspectSchema,
    prompt: `Extract a structured prospect for ${companyName} from the analysis below. Every field must come from the analysis text — do not invent values. Each signal's \`strength\` must be one of: strong, moderate, weak.

Analysis:
${analysisText}`,
  });
  return object;
}

export async function researchCompany(companyName: string): Promise<{ prospect: Prospect; steps: StepResult<Tools>[] }> {
  // The provider treats an empty-string key as present and fails later with an opaque 401.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) — get a key at https://console.anthropic.com.',
    );
  }

  const domain = normalizeCompanyKey(companyName);
  if (!domain) throw new Error(`Cannot derive a domain key from company name "${companyName}".`);

  // Opened before the loop so missing Airtable env fails fast, closed in finally (§12.3).
  const client = await getAirtableMcp();
  try {
    const brainPrompt = readFileSync(BRAIN_PROMPT_PATH, 'utf-8');
    const { tools, resetStepCounter } = buildTools();

    const result = await generateText({
      model: anthropic('claude-haiku-4-5'),
      system: brainPrompt,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      prepareStep: ({ stepNumber, messages }) => {
        resetStepCounter();
        // Last step: no tools and an explicit instruction, so the loop ends on a written analysis instead of
        // more narrated search intent.
        return stepNumber === MAX_STEPS - 1
          ? { toolChoice: 'none', messages: [...messages, { role: 'user', content: FINAL_STEP_NOTICE }] }
          : undefined;
      },
      prompt: `Research ${companyName} as a sales prospect.`,
    });

    const structured = await structureProspect(result.text, companyName);
    const prospect = ProspectSchema.parse({ ...structured, domain, lastResearched: new Date().toISOString() });

    try {
      await upsertProspect(client, prospect);
    } catch (err) {
      // §15: surface the error, but print the prospect so the work isn't lost.
      console.error('Airtable upsert failed; prospect follows so the research is not lost:\n' + JSON.stringify(prospect, null, 2));
      throw err;
    }

    return { prospect, steps: result.steps };
  } finally {
    try {
      await client.close();
    } catch (err) {
      console.warn('[cleanup] Airtable MCP client close failed:', err);
    }
  }
}
