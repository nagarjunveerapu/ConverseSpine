import type { TurnRuntime } from '../runtime/deps.js';
import type { ConversationRow, MemoryView, ProjectRow, TurnLedgerRow } from '../types.js';
import type { NdConversation, NdProjectSummary, NdSearchMatch } from './nayadesk-client.js';

let sessionConversationId: string | null = null;

function parseShortlist(raw: string): string[] {
  try {
    return JSON.parse(raw || '[]') as string[];
  } catch {
    return [];
  }
}

function parsePending(conv: NdConversation): MemoryView['pending'] {
  if (!conv.pending_action) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(conv.pending_action_payload || '{}') as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return { kind: conv.pending_action, payload };
}

function mapConversation(conv: NdConversation): ConversationRow {
  return {
    id: conv.conversation_id,
    buyer_phone: conv.buyer_phone,
    builder_id: conv.builder_id,
    budget: conv.budget_inr || null,
    bhk: conv.bhk_preference || null,
    location: conv.location_pref || null,
    purpose: conv.purpose || null,
    focused_project_id: conv.project_id || null,
    shortlist_json: conv.shortlist_project_ids || '[]',
    status: conv.status,
    pending_json: conv.pending_action ? JSON.stringify(parsePending(conv)) : null,
  };
}

export function budgetToMaxInr(budget: string | undefined): number | undefined {
  if (!budget) return undefined;
  const m = budget.match(/([\d.]+)(?:\s*-\s*([\d.]+))?\s*( lakh| lakhs| l| cr| crore)/i);
  if (!m) return undefined;
  const high = m[2] ? parseFloat(m[2]) : parseFloat(m[1]);
  const unit = m[3].toLowerCase();
  const lakhs = unit.includes('cr') || unit.includes('crore') ? high * 100 : high;
  return Math.round(lakhs * 100_000);
}

function matchToProjectRow(m: NdSearchMatch, builderId: string): ProjectRow {
  return {
    id: m.project_id,
    builder_id: builderId,
    name: m.name,
    micro_market: m.micro_market,
    starting_price_lakhs: Math.round(m.starting_price_inr / 100_000),
    bhk_options: '[]',
    rera: '',
  };
}

export async function ensureConversation(
  rt: TurnRuntime,
  buyerPhone: string,
  builderId?: string,
): Promise<string> {
  if (sessionConversationId) return sessionConversationId;
  const resp = await rt.crm.upsertLead({
    builder_id: builderId ?? rt.defaultBuilderId(),
    buyer_phone: buyerPhone,
  });
  sessionConversationId = resp.conversation_id;
  return resp.conversation_id;
}

export function setSessionConversationId(id: string): void {
  sessionConversationId = id;
}

export async function buildMemory(rt: TurnRuntime, conversationId: string): Promise<MemoryView> {
  const env = rt.env as import('../env.js').Env;
  const cacheKey = `ctx:${conversationId}`;

  if (env.TURN_CACHE) {
    const cached = await env.TURN_CACHE.get(cacheKey, 'json') as MemoryView | null;
    if (cached) return cached;
  }

  const ctx = await rt.crm.conversationContext(conversationId);
  const conversation = mapConversation(ctx.conversation);
  const shortlist = parseShortlist(ctx.conversation.shortlist_project_ids);
  const pending = parsePending(ctx.conversation);

  const memory: MemoryView = {
    conversation,
    facts: {
      budget: ctx.conversation.budget_inr || undefined,
      bhk: ctx.conversation.bhk_preference || undefined,
      location: ctx.conversation.location_pref || undefined,
      purpose: ctx.conversation.purpose || undefined,
      project_id: ctx.conversation.project_id || undefined,
    },
    pending,
    shortlist,
    focusedProject: ctx.project,
    builderName: ctx.builder?.name,
    builder: ctx.builder ?? undefined,
    returningBuyer: ctx.returning_buyer ?? null,
    turnIndex: Math.max(1, ctx.conversation.turn_count || 0),
    objectionPlaybooks: ctx.objection_playbooks,
  };

  if (env.TURN_CACHE) {
    await env.TURN_CACHE.put(cacheKey, JSON.stringify(memory), { expirationTtl: 60 });
  }
  return memory;
}

export async function upsertFact(
  rt: TurnRuntime,
  conversationId: string,
  slot: string,
  value: string,
): Promise<void> {
  await rt.crm.applyStateWrites(conversationId, [{ op: 'set_slot', slot, value }]);
  const env = rt.env as import('../env.js').Env;
  await env.TURN_CACHE?.delete(`ctx:${conversationId}`);
  if (slot === 'project_id') {
    const lead = (await rt.crm.getLead(conversationId)).lead;
    await rt.crm.upsertLead({
      builder_id: lead.builder_id,
      buyer_phone: lead.buyer_phone,
      project_id: value,
    });
  }
}

export async function setPending(
  rt: TurnRuntime,
  conversationId: string,
  pending: MemoryView['pending'],
): Promise<void> {
  if (!pending) {
    await rt.crm.applyStateWrites(conversationId, [{ op: 'set_pending_action', pending: null }]);
    return;
  }
  await rt.crm.applyStateWrites(conversationId, [
    { op: 'set_pending_action', pending: { kind: pending.kind, payload: pending.payload } },
  ]);
}

export async function appendShortlist(
  rt: TurnRuntime,
  conversationId: string,
  projectId: string,
): Promise<void> {
  const memory = await buildMemory(rt, conversationId);
  const list = [...memory.shortlist];
  if (!list.includes(projectId)) list.push(projectId);
  await rt.crm.applyStateWrites(conversationId, [
    { op: 'set_shortlist_project_ids', project_ids: list.slice(0, 3) },
  ]);
}

export async function searchProjects(
  rt: TurnRuntime,
  builderId: string,
  filters: { location?: string; bhk?: string; maxBudgetInr?: number; searchText?: string },
): Promise<ProjectRow[]> {
  const resp = await rt.crm.searchProjects({
    builder_id: builderId,
    ...(filters.searchText ? { search_text: filters.searchText } : {}),
    ...(filters.maxBudgetInr ? { budget_max_inr: filters.maxBudgetInr } : {}),
    ...(filters.location ? { locations: [filters.location] } : {}),
    ...(filters.bhk ? { bhks: [filters.bhk] } : {}),
    max_results: 5,
  });
  return resp.matches.map((m) => matchToProjectRow(m, builderId));
}

export async function resolveProject(
  rt: TurnRuntime,
  conversationId: string,
  projectIdOrName: string,
): Promise<ProjectRow | undefined> {
  const memory = await buildMemory(rt, conversationId);
  const builderId = memory.conversation.builder_id;

  if (memory.focusedProject?.project_id === projectIdOrName) {
    return summaryToProjectRow(memory.focusedProject, builderId);
  }

  if (projectIdOrName.includes('-')) {
    try {
      const row = await rt.crm.getProject(projectIdOrName);
      return projectApiToRow(row, builderId);
    } catch {
      /* fall through to name search */
    }
  }

  const rows = await searchProjects(rt, builderId, {
    searchText: projectIdOrName,
  });
  return (
    rows.find((p) => p.id === projectIdOrName) ??
    rows.find((p) => p.name.toLowerCase().includes(projectIdOrName.toLowerCase())) ??
    rows[0]
  );
}

function projectApiToRow(
  row: {
    project_id: string;
    name: string;
    micro_market: string;
    rera_number?: string;
    entry_price_band?: string;
  },
  builderId: string,
): ProjectRow {
  const band = row.entry_price_band?.match(/([\d.]+)/);
  return {
    id: row.project_id,
    builder_id: builderId,
    name: row.name,
    micro_market: row.micro_market,
    starting_price_lakhs: band ? parseFloat(band[1]) : 0,
    bhk_options: '[]',
    rera: row.rera_number ?? '',
  };
}

function summaryToProjectRow(p: NdProjectSummary, builderId: string): ProjectRow {
  const band = p.entry_price_band.match(/([\d.]+)/);
  return {
    id: p.project_id,
    builder_id: builderId,
    name: p.name,
    micro_market: p.micro_market,
    starting_price_lakhs: band ? parseFloat(band[1]) : 0,
    bhk_options: '[]',
    rera: p.rera_number,
  };
}

export async function fetchPricingQuote(
  rt: TurnRuntime,
  conversationId: string,
  projectIdOrName: string,
  unitType?: string,
): Promise<{
  project_name: string;
  starting_price_lakhs: number;
  components: Array<{ label: string; value_display: string }>;
}> {
  const project = await resolveProject(rt, conversationId, projectIdOrName);
  if (!project) throw new Error(`project_not_found:${projectIdOrName}`);
  const quote = await rt.crm.pricingQuote({
    conversation_id: conversationId,
    project_id: project.id,
    unit_type: unitType,
  });
  const components = quote.components_quoted.map((c) => ({
    label: c.label,
    value_display: c.value || c.notes_buyer_facing,
  }));
  const priceMatch = components.find((c) => /price|starting/i.test(c.label));
  const lakhsMatch = priceMatch?.value_display.match(/([\d.]+)/);
  return {
    project_name: project.name,
    starting_price_lakhs: lakhsMatch ? parseFloat(lakhsMatch[1]) : project.starting_price_lakhs,
    components,
  };
}

export async function recordVisit(
  rt: TurnRuntime,
  conversationId: string,
  projectId: string,
  humanLabel: string,
): Promise<void> {
  const lead = (await rt.crm.getLead(conversationId)).lead;
  await rt.crm.upsertLead({
    builder_id: lead.builder_id,
    buyer_phone: lead.buyer_phone,
    visit_date_pref: humanLabel,
    project_id: projectId,
  });
}

export async function listFacts(rt: TurnRuntime, conversationId: string): Promise<Record<string, string>> {
  const memory = await buildMemory(rt, conversationId);
  return {
    budget: memory.facts.budget ?? '',
    bhk: memory.facts.bhk ?? '',
    location: memory.facts.location ?? '',
    purpose: memory.facts.purpose ?? '',
    project_id: memory.facts.project_id ?? '',
    project_state: memory.conversation.status,
    shortlist: memory.shortlist.join(', '),
  };
}

export async function listLedger(rt: TurnRuntime, conversationId: string): Promise<TurnLedgerRow[]> {
  const { messages } = await rt.crm.listMessages(conversationId);
  const rows: TurnLedgerRow[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i += 2) {
    const inbound = messages[i];
    const outbound = messages[i + 1];
    if (!inbound || inbound.direction !== 'inbound') continue;
    turn += 1;
    rows.push({
      conversation_id: conversationId,
      turn_index: turn,
      buyer_text: inbound.content,
      composer: 'nayadesk',
      tool_names: '',
      reply_text: outbound?.direction === 'outbound' ? outbound.content : '',
      snapshot_json: '{}',
      created_at: inbound.created_at,
    });
  }
  return rows;
}

export async function nextTurnIndex(rt: TurnRuntime, conversationId: string): Promise<number> {
  try {
    const ctx = await rt.crm.turnLedgerContext(conversationId);
    return ctx.next_turn_index;
  } catch {
    const ledger = await listLedger(rt, conversationId);
    return ledger.length ? ledger[ledger.length - 1].turn_index + 1 : 1;
  }
}
