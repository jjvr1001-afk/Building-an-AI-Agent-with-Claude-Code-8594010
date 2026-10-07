import { tool } from 'ai';
import { z } from 'zod';

// SEO-spam finance listicles that surface for any company-name query and carry no support-fit signal.
export const BLOCKED_DOMAINS = [
  'tipranks.com',
  'seekingalpha.com',
  'fool.com',
  'benzinga.com',
  'marketbeat.com',
  'zacks.com',
  'investorplace.com',
];

const MAX_RESULTS = 5;
const DEFAULT_RECENCY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

type TavilyRawResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string | null;
};

function isBlocked(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

export const searchWeb = tool({
  description:
    'Search the web for recent news about a company — funding, hiring, product launches, leadership changes, ' +
    'support/CX initiatives. Use this to gather evidence for prospect research. Returns up to 5 recent results ' +
    '(title, url, snippet, publishedDate) with SEO-spam finance sites filtered out. ' +
    'recencyDays limits how far back to look (default 90).',
  inputSchema: z.object({
    query: z.string(),
    recencyDays: z.number().int().positive().optional(),
  }),
  execute: async ({ query, recencyDays }): Promise<SearchResult[]> => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'TAVILY_API_KEY is not set. Add it to .env (see .env.example) — get a key at https://app.tavily.com.',
      );
    }

    const days = recencyDays ?? DEFAULT_RECENCY_DAYS;

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        topic: 'news',
        days,
        max_results: MAX_RESULTS,
        exclude_domains: BLOCKED_DOMAINS,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Tavily search failed (${res.status} ${res.statusText}): ${body.slice(0, 200)} — ` +
          'check your key, usage, and rate limits on the Tavily dashboard (https://app.tavily.com).',
      );
    }

    const data = (await res.json()) as { results?: TavilyRawResult[] };
    const cutoff = Date.now() - days * DAY_MS;

    const results: SearchResult[] = [];
    for (const r of data.results ?? []) {
      if (!r.url || isBlocked(r.url)) continue;
      const ts = r.published_date ? Date.parse(r.published_date) : NaN;
      if (Number.isNaN(ts) || ts < cutoff) continue;
      results.push({
        title: r.title ?? '',
        url: r.url,
        snippet: r.content ?? '',
        publishedDate: r.published_date!,
      });
    }
    return results;
  },
});
