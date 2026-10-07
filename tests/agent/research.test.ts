import { afterEach, describe, expect, it, vi } from 'vitest';
import { researchCompany } from '../../src/agent/research.ts';

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

if (!HAS_KEY) {
  console.warn('[skip] ANTHROPIC_API_KEY unset — researchCompany real-API suite skipped');
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
    const result = await researchCompany('Stripe');
    expect(typeof result).toBe('string');
    expect(result.trim().length).toBeGreaterThan(0);
  });
});
