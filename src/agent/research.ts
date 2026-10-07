import { anthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, type StepResult } from 'ai';
import { readFileSync } from 'node:fs';
import { searchWeb } from '../tools/tavily.ts';
import { addPreference, listPreferences, removePreference } from '../memory/preferences.ts';

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

export async function researchCompany(companyName: string): Promise<{ text: string; steps: StepResult<Tools>[] }> {
  // The provider treats an empty-string key as present and fails later with an opaque 401.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) — get a key at https://console.anthropic.com.',
    );
  }

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

  return { text: result.text, steps: result.steps };
}
