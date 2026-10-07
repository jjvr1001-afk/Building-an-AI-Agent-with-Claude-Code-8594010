import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { searchWeb, BLOCKED_DOMAINS } from '../../src/tools/tavily.ts';

type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const HAS_KEY = !!process.env.TAVILY_API_KEY;

if (!HAS_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — Tavily real-API suite skipped');
}

async function search(input: { query: string; recencyDays?: number }): Promise<SearchResult[]> {
  return (await searchWeb.execute!(
    input,
    { toolCallId: 'test', messages: [] } satisfies ToolCallOptions,
  )) as SearchResult[];
}

function expectWithinDays(results: SearchResult[], days: number) {
  const now = Date.now();
  for (const r of results) {
    const ts = Date.parse(r.publishedDate);
    expect(Number.isNaN(ts), `unparseable publishedDate: ${r.publishedDate}`).toBe(false);
    expect(now - ts, `${r.url} published ${r.publishedDate}`).toBeLessThanOrEqual(days * DAY_MS);
  }
}

function isBlocked(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

describe('Tavily — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(search({ query: 'q' })).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe('Tavily — blocklist', () => {
  it('includes the required SEO-spam finance domains and ships with 5+ entries', () => {
    expect(BLOCKED_DOMAINS).toEqual(
      expect.arrayContaining(['tipranks.com', 'seekingalpha.com', 'fool.com', 'benzinga.com']),
    );
    expect(BLOCKED_DOMAINS.length).toBeGreaterThanOrEqual(5);
  });
});

describe.skipIf(!HAS_KEY)('Tavily — real API', () => {
  let defaultResults: SearchResult[];

  beforeAll(async () => {
    defaultResults = await search({ query: 'Stripe funding announcement' });
  }, 60_000);

  it('returns a non-empty result list for a normal query', () => {
    expect(defaultResults.length).toBeGreaterThan(0);
  });

  it('returns results with exactly { title, url, snippet, publishedDate }', () => {
    expect(defaultResults.length).toBeGreaterThan(0);
    for (const r of defaultResults) {
      expect(Object.keys(r).sort()).toEqual(['publishedDate', 'snippet', 'title', 'url']);
      expect(typeof r.title).toBe('string');
      expect(typeof r.url).toBe('string');
      expect(typeof r.snippet).toBe('string');
      expect(typeof r.publishedDate).toBe('string');
    }
  });

  it('defaults recencyDays to 90 when the caller does not specify it', () => {
    expect(defaultResults.length).toBeGreaterThan(0);
    expectWithinDays(defaultResults, 90);
  });

  it('only returns results with a parseable publishedDate inside the requested recencyDays window', async () => {
    const results = await search({ query: 'Shopify news', recencyDays: 14 });
    expect(results.length).toBeGreaterThan(0);
    expectWithinDays(results, 14);
  });

  it('excludes results from blocklisted domains', async () => {
    // Stock-ticker queries reliably surface tipranks / seekingalpha / fool / benzinga.
    const results = await search({ query: 'NVIDIA stock analyst price target' });
    expect(results.length).toBeGreaterThan(0);
    const leaked = results.filter((r) => isBlocked(r.url)).map((r) => r.url);
    expect(leaked).toEqual([]);
  });
});
