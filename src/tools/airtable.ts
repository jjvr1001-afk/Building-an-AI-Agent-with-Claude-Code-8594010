import { experimental_createMCPClient, type experimental_MCPClient } from '@ai-sdk/mcp';

// Airtable's hosted MCP endpoint speaks Streamable HTTP; 'sse' now returns 405 (PRD §4.2).
const AIRTABLE_MCP_URL = 'https://mcp.airtable.com/mcp/';

// Exact names pinned in PRD §12.3. Looked up by exact key — never fuzzy-matched (§13.4c).
const REQUIRED_TOOLS = [
  'list_tables_for_base',
  'list_records_for_table',
  'create_records_for_table',
  'update_records_for_table',
  'delete_records_for_table',
] as const;
type ToolName = (typeof REQUIRED_TOOLS)[number];

const PROSPECT_FIELDS = [
  'domain',
  'companyName',
  'overview',
  'signals',
  'leadScore',
  'scoreReasoning',
  'suggestedAngle',
  'status',
  'lastResearched',
] as const;
type ProspectField = (typeof PROSPECT_FIELDS)[number];

// TODO(structurer + persistence): replace with `import type { Prospect } from '../agent/research.ts'`
// once ProspectSchema (§7.1) lands. Mirrors §7.1 until then.
type Prospect = {
  companyName: string;
  domain: string;
  overview: string;
  signals: { name: string; description: string; strength: 'strong' | 'moderate' | 'weak' }[];
  leadScore: number;
  scoreReasoning: string;
  suggestedAngle: string;
  lastResearched: string;
};

type McpTool = { execute: (args: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown> };
type McpEnvelope = { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown };

type Resolved = {
  baseId: string;
  tools: Record<ToolName, McpTool>;
  prospects: { tableId: string; fieldIds: Record<ProspectField, string> };
};

function requireEnv(name: 'AIRTABLE_API_KEY' | 'AIRTABLE_BASE_ID'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to your Codespaces secrets or .env (see .env.example).`);
  }
  return value;
}

// Opens the Airtable MCP client. Callers own the lifecycle: open at the top, close() in finally.
export async function getAirtableMcp(): Promise<experimental_MCPClient> {
  const apiKey = requireEnv('AIRTABLE_API_KEY');
  requireEnv('AIRTABLE_BASE_ID');
  return experimental_createMCPClient({
    transport: {
      type: 'http',
      url: AIRTABLE_MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  });
}

// Every MCP result is inspected: isError: true arrives as a success-shaped object, not an exception (§12.3).
async function call<T>(tool: McpTool, args: Record<string, unknown>): Promise<T> {
  const result = (await tool.execute(args, { toolCallId: 'airtable', messages: [] })) as McpEnvelope;
  if (result.isError) {
    throw new Error(`Airtable write failed: ${result.content?.[0]?.text ?? 'unknown MCP error'}`);
  }
  return (result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? 'null')) as T;
}

// Tool handles, table ID, and field-ID map are resolved once per client and reused (§12.3).
const resolvedByClient = new WeakMap<experimental_MCPClient, Promise<Resolved>>();

function resolve(client: experimental_MCPClient): Promise<Resolved> {
  let resolved = resolvedByClient.get(client);
  if (!resolved) {
    resolved = discover(client);
    resolved.catch(() => resolvedByClient.delete(client));
    resolvedByClient.set(client, resolved);
  }
  return resolved;
}

async function discover(client: experimental_MCPClient): Promise<Resolved> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const discovered = (await client.tools()) as unknown as Record<string, McpTool>;

  const missing = REQUIRED_TOOLS.filter((name) => !(name in discovered));
  if (missing.length > 0) {
    throw new Error(
      `Airtable write failed: MCP server is missing required tool(s) ${missing.join(', ')}. ` +
        'Update PRD §12.3 + §13.4 if the server renamed them.',
    );
  }
  const tools = Object.fromEntries(REQUIRED_TOOLS.map((name) => [name, discovered[name]])) as Record<ToolName, McpTool>;

  const { tables } = await call<{ tables: { id: string; name: string; fields: { id: string; name: string }[] }[] }>(
    tools.list_tables_for_base,
    { baseId },
  );
  const table = tables.find((t) => t.name === 'Prospects');
  if (!table) throw new Error('Airtable write failed: table "Prospects" not found in the base (see PRD §13.2).');

  const byName = new Map(table.fields.map((f) => [f.name, f.id]));
  const missingFields = PROSPECT_FIELDS.filter((name) => !byName.has(name));
  if (missingFields.length > 0) {
    throw new Error(`Airtable write failed: Prospects is missing field(s) ${missingFields.join(', ')} (see PRD §13.2).`);
  }
  const fieldIds = Object.fromEntries(PROSPECT_FIELDS.map((name) => [name, byName.get(name)!])) as Record<
    ProspectField,
    string
  >;

  return { baseId, tools, prospects: { tableId: table.id, fieldIds } };
}

function signalsToMarkdown(signals: Prospect['signals']): string {
  return signals.map((s) => `- **${s.name}** (${s.strength}): ${s.description}`).join('\n');
}

export async function getProspectIdByDomain(client: experimental_MCPClient, domain: string): Promise<string | null> {
  const { baseId, tools, prospects } = await resolve(client);
  const { records } = await call<{ records: { id: string }[] }>(tools.list_records_for_table, {
    baseId,
    tableId: prospects.tableId,
    fieldIds: [prospects.fieldIds.domain],
    filters: { operands: [{ operator: '=', operands: [prospects.fieldIds.domain, domain] }] },
  });
  // More than one row means the filter was dropped or §13.2's unique-domain rule is broken — never guess.
  if (records.length > 1) {
    throw new Error(`Airtable write failed: ${records.length} Prospects rows match domain "${domain}"; expected at most 1.`);
  }
  return records[0]?.id ?? null;
}

export async function upsertProspect(client: experimental_MCPClient, prospect: Prospect): Promise<string> {
  const { baseId, tools, prospects } = await resolve(client);
  const f = prospects.fieldIds;
  const fields: Record<string, unknown> = {
    [f.domain]: prospect.domain,
    [f.companyName]: prospect.companyName,
    [f.overview]: prospect.overview,
    [f.signals]: signalsToMarkdown(prospect.signals),
    [f.leadScore]: prospect.leadScore,
    [f.scoreReasoning]: prospect.scoreReasoning,
    [f.suggestedAngle]: prospect.suggestedAngle,
    [f.lastResearched]: prospect.lastResearched,
  };

  const existingId = await getProspectIdByDomain(client, prospect.domain);
  if (existingId) {
    // status is left alone on update so a re-research doesn't reset 'contacted' / 'replied'.
    await call(tools.update_records_for_table, {
      baseId,
      tableId: prospects.tableId,
      records: [{ id: existingId, fields }],
    });
    return existingId;
  }

  const { records } = await call<{ records: { id: string }[] }>(tools.create_records_for_table, {
    baseId,
    tableId: prospects.tableId,
    records: [{ fields: { ...fields, [f.status]: 'researched' } }],
  });
  return records[0].id;
}

export async function deleteProspectByDomain(client: experimental_MCPClient, domain: string): Promise<number> {
  const id = await getProspectIdByDomain(client, domain);
  if (!id) return 0;
  const { baseId, tools, prospects } = await resolve(client);
  await call(tools.delete_records_for_table, { baseId, tableId: prospects.tableId, recordIds: [id] });
  return 1;
}
