import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { readFileSync } from 'node:fs';

const BRAIN_PROMPT_PATH = new URL('./prompts/brain.md', import.meta.url);

export async function researchCompany(companyName: string): Promise<string> {
  // The provider treats an empty-string key as present and fails later with an opaque 401.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) — get a key at https://console.anthropic.com.',
    );
  }

  const result = await generateText({
    model: anthropic('claude-haiku-4-5'),
    system: readFileSync(BRAIN_PROMPT_PATH, 'utf-8'),
    prompt: `Research ${companyName} as a sales prospect.`,
  });

  return result.text;
}
