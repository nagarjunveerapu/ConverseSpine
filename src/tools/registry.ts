import type { TurnRuntime } from '../runtime/deps.js';
import {
  appendShortlist,
  budgetToMaxInr,
  fetchPricingQuote,
  recordVisit,
  resolveProject,
  setPending,
} from '../crm/repository.js';
import type { MemoryView, ToolCall, ToolResult } from '../types.js';
import { normalizeProjectQuery } from '../nlu/extractors.js';
import { searchProjectsWithFallback } from './search-fallback.js';

export async function runTool(
  rt: TurnRuntime,
  call: ToolCall,
  memory: MemoryView,
  conversationId: string,
): Promise<ToolResult> {
  const builderId = memory.conversation.builder_id;

  switch (call.name) {
    case 'catalog_brief': {
      const resp = await rt.crm.searchProjects({ builder_id: builderId, max_results: 10 });
      const projects = resp.matches.map((m) => ({
        name: m.name,
        micro_market: m.micro_market,
        project_type: m.project_type,
        starting_price_display: m.starting_price_display,
      }));
      return {
        success: true,
        output: {
          total: resp.matches.length,
          projects,
          portfolio_orientation: projects,
        },
      };
    }
    case 'search_projects': {
      const matches = await searchProjectsWithFallback(rt, builderId, memory);
      const rows = matches
        .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))
        .map((m) => ({
          id: m.project_id,
          name: m.name,
          micro_market: m.micro_market,
          project_type: m.project_type,
          starting_price_lakhs: Math.round(m.starting_price_inr / 100_000),
          match_reasons: m.match_reasons ?? [],
          starting_price_display: m.starting_price_display,
        }));
      for (const p of rows.slice(0, 3)) await appendShortlist(rt, conversationId, p.id);
      return { success: true, output: { projects: rows.slice(0, 5) } };
    }
    case 'give_pricing': {
      const pid = String(call.args.project_id ?? memory.facts.project_id ?? '');
      if (!pid) return { success: false, output: { error: 'project_not_found' } };
      try {
        const quote = await fetchPricingQuote(rt, conversationId, pid, memory.facts.bhk);
        return {
          success: true,
          output: {
            project_id: pid,
            project_name: quote.project_name,
            starting_price_lakhs: quote.starting_price_lakhs,
            components: quote.components,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, output: { error: 'pricing_unavailable', detail: msg } };
      }
    }
    case 'lookup_project': {
      const pid = String(call.args.project_id ?? memory.facts.project_id ?? '');
      const p = await resolveProject(rt, conversationId, pid);
      if (!p) return { success: false, output: { error: 'not_found' } };
      let summary = '';
      let project_type = '';
      let possession_date = '';
      try {
        const full = await rt.crm.getProject(p.id);
        summary = full.summary ?? '';
        project_type = full.project_type ?? '';
        possession_date = full.possession_date ?? '';
      } catch {
        /* optional enrichment */
      }
      return {
        success: true,
        output: {
          id: p.id,
          name: p.name,
          micro_market: p.micro_market,
          project_type,
          summary,
          possession_date,
          starting_price_lakhs: p.starting_price_lakhs,
          starting_price_display: p.starting_price_lakhs
            ? `₹${p.starting_price_lakhs} L`
            : undefined,
          rera: p.rera,
        },
      };
    }
    case 'compare_projects': {
      const names = (call.args.project_names as string[] | undefined) ?? [];
      const presetIds = (call.args.project_ids as string[] | undefined) ?? [];
      const ids: string[] = [];
      for (const name of names) {
        const p = await resolveProject(rt, conversationId, normalizeProjectQuery(name));
        if (p) ids.push(p.id);
      }
      if (ids.length < 2) {
        for (const id of presetIds) {
          if (!ids.includes(id)) ids.push(id);
        }
      }
      if (ids.length < 2) {
        return { success: false, output: { error: 'need_two_projects', ids } };
      }
      try {
        const resp = await rt.crm.compareProjects({
          conversation_id: conversationId,
          project_ids: ids.slice(0, 3),
        });
        return {
          success: true,
          output: {
            table_text: resp.table_text,
            projects: resp.projects,
            matrix: resp.matrix,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, output: { error: 'compare_unavailable', detail: msg } };
      } finally {
        for (const id of ids.slice(0, 3)) await appendShortlist(rt, conversationId, id);
      }
    }
    case 'share_media': {
      const pid = String(call.args.project_id ?? memory.facts.project_id ?? memory.shortlist[0] ?? '');
      const assetKind = String(call.args.asset_kind ?? 'brochure');
      if (!pid) return { success: false, output: { error: 'project_not_found' } };
      try {
        const resp = await rt.crm.mediaShare({
          project_id: pid,
          conversation_id: conversationId,
          asset_kind: assetKind,
          unit_type_filter: call.args.unit_type ? String(call.args.unit_type) : undefined,
        });
        const p = await resolveProject(rt, conversationId, pid);
        return {
          success: resp.allowed,
          output: {
            allowed: resp.allowed,
            project_name: p?.name,
            asset_kind: assetKind,
            title: resp.asset?.title,
            cdn_url: resp.asset?.cdn_url,
            reason: resp.reason,
            redirect_hint: resp.redirect_hint,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, output: { error: 'media_unavailable', detail: msg } };
      }
    }
    case 'list_units': {
      const pid = String(call.args.project_id ?? memory.facts.project_id ?? memory.shortlist[0] ?? '');
      if (!pid) return { success: false, output: { error: 'project_not_found' } };
      try {
        const resolved = await resolveProject(rt, conversationId, pid);
        const resp = await rt.crm.listProjectUnits(resolved?.id ?? pid);
        const publicUnits = resp.units.filter(
          (u) => u.disclosure_tier !== 'admin_only' && u.is_available,
        );
        return {
          success: true,
          output: {
            project_id: resolved?.id ?? pid,
            project_name: resolved?.name,
            units: publicUnits.map((u) => ({
              unit_type: u.unit_type,
              price_display: u.price_display,
              size_sqft:
                u.size_min_sqft === u.size_max_sqft
                  ? `${u.size_min_sqft} sqft`
                  : `${u.size_min_sqft}-${u.size_max_sqft} sqft`,
            })),
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, output: { error: 'units_unavailable', detail: msg } };
      }
    }
    case 'propose_visit': {
      const pid = String(call.args.project_id ?? memory.facts.project_id ?? '');
      const label = String(call.args.human_label ?? 'Saturday');
      const p = pid ? await resolveProject(rt, conversationId, pid) : undefined;
      return {
        success: true,
        output: {
          project_id: pid,
          project_name: p?.name ?? 'the project',
          human_label: label,
          proposal_text: `Shall I block ${label} for your visit to ${p?.name ?? 'the project'}? Reply yes to confirm.`,
        },
      };
    }
    case 'confirm_visit': {
      const pid = String(call.args.project_id ?? memory.facts.project_id ?? '');
      const label = String(call.args.human_label ?? 'Saturday');
      const p = pid ? await resolveProject(rt, conversationId, pid) : undefined;
      await recordVisit(rt, conversationId, pid, label);
      await setPending(rt, conversationId, null);
      return {
        success: true,
        output: {
          project_id: pid,
          project_name: p?.name ?? 'the project',
          human_label: label,
        },
      };
    }
    default:
      return { success: false, output: { error: `unknown_tool:${call.name}` } };
  }
}

export async function applyDecideWrites(
  rt: TurnRuntime,
  conversationId: string,
  writes: Array<{ op: string; [key: string]: unknown }>,
): Promise<void> {
  for (const w of writes) {
    if (w.op === 'set_pending') {
      await setPending(rt, conversationId, w.pending as MemoryView['pending']);
    }
    if (w.op === 'clear_pending') await setPending(rt, conversationId, null);
  }
}
