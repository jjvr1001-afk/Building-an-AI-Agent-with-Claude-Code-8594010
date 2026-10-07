import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { researchCompany } from '../../src/agent/research.ts';

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const HAS_TAVILY_KEY = !!process.env.TAVILY_API_KEY;

if (!HAS_KEY) {
  console.warn('[skip] ANTHROPIC_API_KEY unset — researchCompany real-API suite skipped');
}

if (!HAS_KEY || !HAS_TAVILY_KEY) {
  console.warn(
    '[skip] ANTHROPIC_API_KEY and TAVILY_API_KEY are both required — researchCompany search/preferences-wiring suite skipped',
  );
}

const PREFS_PATH = fileURLToPath(new URL('../../src/memory/preferences.md', import.meta.url));

describe('researchCompany — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when ANTHROPIC_API_KEY is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(researchCompany('Stripe')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe.skipIf(!HAS_KEY)('researchCompany — real API (researchCompany seed)', () => {
  it('is callable and returns a non-empty response when given a company name', async () => {
    const { text } = await researchCompany('Stripe');
    expect(typeof text).toBe('string');
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe.skipIf(!HAS_KEY || !HAS_TAVILY_KEY)('researchCompany — real API (search + preferences wiring)', () => {
  // Real preferences.md: snapshot before, restore (or delete if it didn't exist) after.
  let originalPrefs: string | null;
  beforeEach(() => {
    originalPrefs = existsSync(PREFS_PATH) ? readFileSync(PREFS_PATH, 'utf8') : null;
  });
  afterEach(() => {
    if (originalPrefs === null) rmSync(PREFS_PATH, { force: true });
    else writeFileSync(PREFS_PATH, originalPrefs);
  });

  it('invokes searchWeb at least once during a run', async () => {
    const { steps } = await researchCompany('Stripe');
    expect(steps.length).toBeGreaterThan(1);
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames).toContain('searchWeb');
  });

  it('begins with a listPreferences tool call', async () => {
    const { steps } = await researchCompany('Stripe');
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames[0]).toBe('listPreferences');
  });

  it('saves stated feedback via addPreference within the same run', async () => {
    const token = 'Cantonese';
    const { steps } = await researchCompany(
      `UPS. For shipping companies, lead with multilingual deflection across ${token} and Bahasa`,
    );
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames).toContain('addPreference');
    expect(readFileSync(PREFS_PATH, 'utf8')).toContain(token);
  });
});
