import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getAirtableMcp } from '../../src/tools/airtable.ts';

// Exact names pinned in PRD §12.3. If the MCP server renames one, update §12.3 + §13.4 — never loosen this.
const PINNED_TOOLS = [
  'list_tables_for_base',
  'list_records_for_table',
  'create_records_for_table',
  'update_records_for_table',
  'delete_records_for_table',
];

const MISSING = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'].filter((v) => !process.env[v]);
const HAS_ENV = MISSING.length === 0;

if (!HAS_ENV) {
  console.warn(`[skip] ${MISSING.join(', ')} unset — Airtable MCP real-API suite skipped`);
}

describe('Airtable MCP — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error naming AIRTABLE_API_KEY when it is missing', async () => {
    vi.stubEnv('AIRTABLE_API_KEY', '');
    vi.stubEnv('AIRTABLE_BASE_ID', 'appPlaceholder');
    await expect(getAirtableMcp()).rejects.toThrow(/AIRTABLE_API_KEY/);
  });

  it('throws a clear, actionable error naming AIRTABLE_BASE_ID when it is missing', async () => {
    vi.stubEnv('AIRTABLE_API_KEY', 'patPlaceholder');
    vi.stubEnv('AIRTABLE_BASE_ID', '');
    await expect(getAirtableMcp()).rejects.toThrow(/AIRTABLE_BASE_ID/);
  });
});

describe.skipIf(!HAS_ENV)('Airtable MCP — real API', () => {
  let client: Awaited<ReturnType<typeof getAirtableMcp>> | undefined;
  let closed = false;

  beforeAll(async () => {
    client = await getAirtableMcp();
  }, 60_000);

  afterAll(async () => {
    if (!client || closed) return;
    try {
      await client.close();
    } catch (err) {
      console.warn('[cleanup] Airtable MCP client close failed:', err);
    }
  }, 60_000);

  it('connects to the Airtable MCP server using AIRTABLE_API_KEY', async () => {
    expect(client).toBeDefined();
    const tools = await client!.tools();
    expect(Object.keys(tools).length).toBeGreaterThan(0);
  });

  it('discovers the exact pinned CRUD primitive names from §12.3', async () => {
    const names = Object.keys(await client!.tools());
    for (const name of PINNED_TOOLS) {
      expect(names, `missing pinned MCP tool: ${name}`).toContain(name);
    }
  });

  it('closes the connection cleanly via close()', async () => {
    await expect(client!.close()).resolves.not.toThrow();
    closed = true;
  });
});
