import { runObjectionGraph } from '../graphs/objection.js';
import {
  formatCompareAdvice,
  formatCompareTable,
  formatFirstTouchGreeting,
  formatMediaShare,
  formatPortfolioOrientation,
  formatProjectDetail,
  formatProjectList,
  formatReturningGreeting,
  formatSlotAck,
  formatUnitConfigs,
  stripBuilderNameEnvSuffix,
  type BuilderVoice,
  type CatalogProjectLine,
} from '../experience/copy.js';
import { renderTemplate } from './templates.js';
import type { ComposerKind, MemoryView, ToolResult } from '../types.js';

export interface ComposeContext {
  facts: Record<string, string | undefined>;
  builderName?: string;
  buyerText?: string;
  memory?: MemoryView;
}

function builderVoice(memory?: MemoryView): BuilderVoice {
  const b = memory?.builder;
  return {
    bot_name: b?.bot_name?.trim() || 'your advisor',
    builder_name: stripBuilderNameEnvSuffix(b?.name ?? memory?.builderName ?? 'our team'),
    bot_signature: b?.bot_signature,
    preferred_tone: b?.preferred_tone,
  };
}

function catalogFromTools(toolResults: ToolResult[]): CatalogProjectLine[] {
  const search = toolResults.find((t) => t.success && Array.isArray(t.output.projects));
  if (search) {
    return (search.output.projects as CatalogProjectLine[]) ?? [];
  }
  const brief = toolResults.find((t) => t.success && Array.isArray(t.output.projects));
  return (brief?.output.projects as CatalogProjectLine[]) ?? [];
}

export function composeTemplate(
  composer: ComposerKind,
  toolResults: ToolResult[],
  ctx: ComposeContext,
): string {
  const voice = builderVoice(ctx.memory);
  const filters = {
    location: ctx.facts.location,
    budget: ctx.facts.budget,
    bhk: ctx.facts.bhk,
    purpose: ctx.facts.purpose,
  };

  switch (composer) {
    case 'template:greeting': {
      const brief = toolResults.find((t) => t.success && Array.isArray(t.output.projects));
      const sample = (brief?.output.projects ?? []) as CatalogProjectLine[];
      const orientation = formatPortfolioOrientation(sample);
      return formatFirstTouchGreeting(voice, orientation);
    }
    case 'template:returning_greeting':
      return formatReturningGreeting(voice, ctx.memory?.returningBuyer?.buyer_name);
    case 'template:compare': {
      const cmp = toolResults.find((t) => t.success && (t.output.table_text || t.output.projects));
      return formatCompareTable(
        cmp?.output.table_text ? String(cmp.output.table_text) : undefined,
        (cmp?.output.projects as Array<{ name?: string }>) ?? [],
      );
    }
    case 'template:compare_advice': {
      const cmp = toolResults.find((t) => t.success && Array.isArray(t.output.projects));
      const projects = (cmp?.output.projects as Array<{
        name?: string;
        micro_market?: string;
        project_type?: string;
        starting_price_lakhs?: number;
        starting_price_display?: string;
        possession_date?: string;
      }>) ?? [];
      return formatCompareAdvice(ctx.buyerText ?? '', projects);
    }
    case 'template:media': {
      const m = toolResults.find((t) => t.output.allowed !== undefined || t.output.cdn_url);
      const o = m?.output ?? {};
      return formatMediaShare({
        project_name: o.project_name ? String(o.project_name) : undefined,
        allowed: Boolean(o.allowed),
        title: o.title ? String(o.title) : undefined,
        cdn_url: o.cdn_url ? String(o.cdn_url) : undefined,
        asset_kind: o.asset_kind ? String(o.asset_kind) : undefined,
        redirect_hint: o.redirect_hint ? String(o.redirect_hint) : undefined,
      });
    }
    case 'template:units': {
      const u = toolResults.find((t) => t.success && Array.isArray(t.output.units));
      return formatUnitConfigs({
        project_name: u?.output.project_name ? String(u.output.project_name) : undefined,
        units: (u?.output.units as Array<{ unit_type: string; price_display?: string; size_sqft?: string }>) ?? [],
      });
    }
    case 'template:welcome_list':
    case 'template:list': {
      const projects = catalogFromTools(toolResults);
      return formatProjectList({
        projects,
        filters,
        includeWelcome: composer === 'template:welcome_list',
        voice,
        portfolioOrientation:
          composer === 'template:welcome_list'
            ? formatPortfolioOrientation(projects)
            : undefined,
      });
    }
    case 'template:detail': {
      const lookup = toolResults.find((t) => t.success && t.output.name);
      if (!lookup) return fallbackLlmStub(toolResults, ctx);
      const o = lookup.output;
      return formatProjectDetail({
        name: String(o.name),
        micro_market: String(o.micro_market ?? ''),
        project_type: o.project_type ? String(o.project_type) : undefined,
        starting_price_display: o.starting_price_display ? String(o.starting_price_display) : undefined,
        starting_price_lakhs: typeof o.starting_price_lakhs === 'number' ? o.starting_price_lakhs : undefined,
        summary: o.summary ? String(o.summary) : undefined,
        possession_date: o.possession_date ? String(o.possession_date) : undefined,
        rera: o.rera ? String(o.rera) : undefined,
      });
    }
    case 'template:pricing': {
      const pr = toolResults.find((t) => t.success && t.output.components);
      return renderTemplate('pricing', {
        project_name: pr?.output.project_name,
        components: pr?.output.components ?? [],
      });
    }
    case 'template:visit_confirm': {
      const visit = toolResults.find((t) => t.success && (t.output.proposal_text || t.output.human_label));
      if (visit?.output.proposal_text) return String(visit.output.proposal_text);
      return renderTemplate('visit_confirm', {
        project_name: visit?.output.project_name,
        human_label: visit?.output.human_label,
      });
    }
    case 'template:visit_ask_day': {
      const pid = ctx.facts.project_id;
      const lookup = toolResults.find((t) => t.success && t.output.name);
      return renderTemplate('visit_ask_day', {
        project_name: lookup?.output.name ?? pid,
      });
    }
    case 'template:legal': {
      const lookup = toolResults.find((t) => t.success && t.output.name);
      const items = [];
      if (lookup?.output.rera) items.push({ label: 'RERA', value: lookup.output.rera });
      if (lookup?.output.micro_market) items.push({ label: 'Location', value: lookup.output.micro_market });
      return renderTemplate('legal', { project_name: lookup?.output.name, items });
    }
    case 'template:objection': {
      const obj = ctx.memory && ctx.buyerText
        ? runObjectionGraph(ctx.buyerText, ctx.memory)
        : null;
      const lookup = toolResults.find((t) => t.success && t.output.name);
      const ack = formatSlotAck(ctx.facts);
      const body = renderTemplate('objection', {
        topic: obj?.topic ?? 'that',
        reframe: obj?.reframe ?? 'We can find an option that fits better.',
        project_name: lookup?.output.name ?? ctx.memory?.focusedProject?.name,
      });
      return ack ? `${ack}\n\n${body}` : body;
    }
    case 'early_exit:ack':
      return "Got it — tell me if you'd like options, pricing, or a site visit.";
    default:
      return fallbackLlmStub(toolResults, ctx);
  }
}

function fallbackLlmStub(toolResults: ToolResult[], ctx: ComposeContext): string {
  const lookup = toolResults.find((t) => t.success && t.output.name);
  if (lookup) {
    const o = lookup.output;
    return formatProjectDetail({
      name: String(o.name),
      micro_market: String(o.micro_market ?? ''),
      project_type: o.project_type ? String(o.project_type) : undefined,
      starting_price_lakhs: typeof o.starting_price_lakhs === 'number' ? o.starting_price_lakhs : undefined,
      summary: o.summary ? String(o.summary) : undefined,
      rera: o.rera ? String(o.rera) : undefined,
    });
  }
  const voice = builderVoice(ctx.memory);
  const parts = [ctx.facts.location, ctx.facts.budget, ctx.facts.bhk].filter(Boolean);
  const ack = formatSlotAck(ctx.facts);
  if (parts.length && ack) {
    return `${ack} Say "show me options" and I'll pull matching projects from our catalog.`;
  }
  if (ack) return `${ack} Name a project or share location and budget — I'll pull live data from the catalog.`;
  return formatFirstTouchGreeting(voice, '');
}

/** Grounding gate: ₹ amounts in reply must appear in tool evidence. */
export function verifyGrounding(
  reply: string,
  toolResults: ToolResult[],
  composer?: string,
): { ok: boolean; reason?: string } {
  if (composer === 'template:compare' || composer === 'template:compare_advice' || composer === 'template:units') {
    return { ok: true };
  }
  const amounts = [...reply.matchAll(/₹\s*([\d.]+)\s*L\b/gi)].map((m) => parseFloat(m[1]));
  if (amounts.length === 0) return { ok: true };

  const allowed = new Set<number>();
  for (const t of toolResults) {
    if (typeof t.output.starting_price_lakhs === 'number') allowed.add(t.output.starting_price_lakhs);
    collectPriceAmounts(String(t.output.starting_price_display ?? ''), allowed);
    const projects = t.output.projects as Array<{
      starting_price_lakhs?: number;
      starting_price_display?: string;
    }> | undefined;
    if (projects) {
      for (const p of projects) {
        if (typeof p.starting_price_lakhs === 'number') allowed.add(p.starting_price_lakhs);
        collectPriceAmounts(p.starting_price_display, allowed);
      }
    }
    const comps = t.output.components as Array<{ value_display?: string; value?: string }> | undefined;
    if (comps) {
      for (const c of comps) {
        collectPriceAmounts(c.value_display ?? c.value, allowed);
      }
    }
    const matrix = t.output.matrix as { rows?: Array<{ values?: string[] }> } | undefined;
    if (matrix?.rows) {
      for (const row of matrix.rows) {
        for (const v of row.values ?? []) collectPriceAmounts(v, allowed);
      }
    }
    if (typeof t.output.table_text === 'string') {
      collectPriceAmounts(t.output.table_text, allowed);
    }
    const units = t.output.units as Array<{ price_display?: string }> | undefined;
    if (units) {
      for (const u of units) collectPriceAmounts(u.price_display, allowed);
    }
  }

  for (const a of amounts) {
    if (![...allowed].some((x) => Math.abs(x - a) < 0.15)) {
      return { ok: false, reason: `ungrounded price ${a}L` };
    }
  }
  return { ok: true };
}

function collectPriceAmounts(raw: string | undefined, allowed: Set<number>): void {
  if (!raw) return;
  for (const m of raw.matchAll(/([\d.]+)\s*(?:L|l|lakh|lakhs|cr|crore)?/g)) {
    const n = parseFloat(m[1]);
    if (!Number.isNaN(n)) allowed.add(n);
  }
}
