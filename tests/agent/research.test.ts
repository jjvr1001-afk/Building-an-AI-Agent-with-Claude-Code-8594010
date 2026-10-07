import { afterEach, describe, expect, it, vi } from 'vitest';
import { researchCompany } from '../../src/agent/research.ts';

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const HAS_TAVILY_KEY = !!process.env.TAVILY_API_KEY;

if (!HAS_KEY) {
  console.warn('[skip] ANTHROPIC_API_KEY unset — researchCompany real-API suite skipped');
}

if (!HAS_TAVILY_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — researchCompany search-wiring suite skipped');
}

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

describe.skipIf(!HAS_KEY || !HAS_TAVILY_KEY)('researchCompany — real API (search wiring)', () => {
  it('invokes searchWeb at least once during a run', async () => {
    const { steps } = await researchCompany('Stripe');
    expect(steps.length).toBeGreaterThan(1);
    const toolNames = steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    expect(toolNames).toContain('searchWeb');
  });
});
