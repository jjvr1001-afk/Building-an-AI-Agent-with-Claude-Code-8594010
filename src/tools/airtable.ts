import { experimental_createMCPClient, type experimental_MCPClient } from '@ai-sdk/mcp';
import type { Prospect } from '../agent/research.ts';

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

const OUTREACH_FIELDS = ['subjectLine', 'prospect', 'emailBody', 'angleReasoning', 'createdAt'] as const;
type OutreachField = (typeof OUTREACH_FIELDS)[number];

type McpTool = { execute: (args: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown> };
type McpEnvelope = { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown };

type Resolved = {
  baseId: string;
  tools: Record<ToolName, McpTool>;
  prospects: { tableId: string; fieldIds: Record<ProspectField, string> };
  // Outreach table (§13.3) — only the pieces the read/delete helpers need.
  outreach: { tableId: string; fieldIds: Record<OutreachField, string> } | null;
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

  // Resolved here so the table list is fetched once; absence only matters to the Outreach helpers (see requireOutreach).
  const outreachTable = tables.find((t) => t.name === 'Outreach');
  const outreachByName = new Map((outreachTable?.fields ?? []).map((f) => [f.name, f.id]));
  const outreach =
    outreachTable && OUTREACH_FIELDS.every((name) => outreachByName.has(name))
      ? {
          tableId: outreachTable.id,
          fieldIds: Object.fromEntries(OUTREACH_FIELDS.map((name) => [name, outreachByName.get(name)!])) as Record<
            OutreachField,
            string
          >,
        }
      : null;

  return { baseId, tools, prospects: { tableId: table.id, fieldIds }, outreach };
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

export type ProspectRecord = { id: string } & Record<Exclude<ProspectField, 'leadScore'>, string | undefined> & {
  leadScore: number | undefined;
};

// Read primitive: record id plus every Prospects field, decoded from cellValuesByFieldId. null on no-match (§12.3).
// `signals` comes back as the Markdown text upsertProspect wrote, not the structured array.
export async function getProspectByDomain(client: experimental_MCPClient, domain: string): Promise<ProspectRecord | null> {
  const { baseId, tools, prospects } = await resolve(client);
  const { records } = await call<{ records: { id: string; cellValuesByFieldId?: Record<string, unknown> }[] }>(
    tools.list_records_for_table,
    {
      baseId,
      tableId: prospects.tableId,
      fieldIds: PROSPECT_FIELDS.map((name) => prospects.fieldIds[name]),
      filters: { operands: [{ operator: '=', operands: [prospects.fieldIds.domain, domain] }] },
    },
  );
  if (records.length > 1) {
    throw new Error(`Airtable write failed: ${records.length} Prospects rows match domain "${domain}"; expected at most 1.`);
  }
  const record = records[0];
  if (!record) return null;
  const decoded = Object.fromEntries(
    PROSPECT_FIELDS.map((name) => {
      const value = record.cellValuesByFieldId?.[prospects.fieldIds[name]];
      // Single selects (status) arrive as {id, name}; unwrap to the option name.
      return [name, typeof value === 'object' && value !== null && 'name' in value ? (value as { name: unknown }).name : value];
    }),
  );
  return { id: record.id, ...decoded } as ProspectRecord;
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

function requireOutreach(resolved: Resolved): NonNullable<Resolved['outreach']> {
  if (!resolved.outreach) {
    throw new Error(
      `Airtable write failed: table "Outreach" or one of its fields (${OUTREACH_FIELDS.join(', ')}) not found in the base (see PRD §13.3).`,
    );
  }
  return resolved.outreach;
}

// Read primitive: Outreach record IDs whose `prospect` link references prospectId. Empty array on no-match (§12.3).
export async function listOutreachByProspectId(client: experimental_MCPClient, prospectId: string): Promise<string[]> {
  const resolved = await resolve(client);
  const { baseId, tools } = resolved;
  const outreach = requireOutreach(resolved);
  const { records } = await call<{ records: { id: string; cellValuesByFieldId?: Record<string, unknown> }[] }>(
    tools.list_records_for_table,
    { baseId, tableId: outreach.tableId, fieldIds: [outreach.fieldIds.prospect] },
  );
  // Linked cells arrive as [{id, name}] on this MCP surface; accept bare rec… strings too in case that shape changes.
  return records
    .filter((r) => {
      const cell = r.cellValuesByFieldId?.[outreach.fieldIds.prospect];
      return (
        Array.isArray(cell) &&
        cell.some((entry) => entry === prospectId || (typeof entry === 'object' && entry !== null && (entry as { id?: string }).id === prospectId))
      );
    })
    .map((r) => r.id);
}

// Test cleanup only. Call before deleteProspectByDomain — Airtable doesn't cascade, and the link lookup needs the prospect (§12.3).
export async function deleteOutreachByProspect(client: experimental_MCPClient, domain: string): Promise<number> {
  const prospectId = await getProspectIdByDomain(client, domain);
  if (!prospectId) return 0;
  const ids = await listOutreachByProspectId(client, prospectId);
  if (ids.length === 0) return 0;
  const resolved = await resolve(client);
  const outreach = requireOutreach(resolved);
  await call(resolved.tools.delete_records_for_table, { baseId: resolved.baseId, tableId: outreach.tableId, recordIds: ids });
  return ids.length;
}

// typecast: true is load-bearing — without it the linked `prospect` cell is silently null-coerced (§13.4).
export async function createOutreach(
  client: experimental_MCPClient,
  prospectId: string,
  outreach: { subjectLine: string; emailBody: string; angleReasoning: string },
): Promise<string> {
  const resolved = await resolve(client);
  const table = requireOutreach(resolved);
  const f = table.fieldIds;
  const { records } = await call<{ records: { id: string }[] }>(resolved.tools.create_records_for_table, {
    baseId: resolved.baseId,
    tableId: table.tableId,
    typecast: true,
    records: [
      {
        fields: {
          [f.subjectLine]: outreach.subjectLine,
          [f.prospect]: [prospectId],
          [f.emailBody]: outreach.emailBody,
          [f.angleReasoning]: outreach.angleReasoning,
          [f.createdAt]: new Date().toISOString(),
        },
      },
    ],
  });
  return records[0].id;
}
