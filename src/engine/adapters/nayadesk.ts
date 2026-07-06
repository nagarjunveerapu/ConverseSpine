import type { NayaDeskClient } from '../../crm/nayadesk-client.js';
import type { EngineCrm, EngineData, StoredVisit } from '../ports.js';
import { formatInr } from '../compose.js';

function splitCsv(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function parseJsonArray(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return s ? [s] : [];
  }
}

function formatYearMonth(s: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = parseInt(m[2]!, 10) - 1;
  return months[mi] ? `${months[mi]} ${m[1]}` : s;
}

function mapLocationIntel(raw: {
  connectivity_summary?: string;
  nearby_pois_json?: string;
  drive_times_json?: string;
  micro_market_overview?: string;
} | null | undefined) {
  if (!raw) return undefined;
  const nearbyPois = parseJsonArray(raw.nearby_pois_json);
  const driveTimes = parseJsonArray(raw.drive_times_json);
  if (!raw.connectivity_summary && !raw.micro_market_overview && !nearbyPois.length && !driveTimes.length) {
    return undefined;
  }
  return {
    ...(raw.connectivity_summary ? { connectivitySummary: raw.connectivity_summary } : {}),
    ...(raw.micro_market_overview ? { microMarketOverview: raw.micro_market_overview } : {}),
    ...(nearbyPois.length ? { nearbyPois } : {}),
    ...(driveTimes.length ? { driveTimes } : {}),
  };
}

export function nayadeskData(crm: NayaDeskClient): EngineData {
  return {
    async search(builderId, filters) {
      const resp = await crm.searchProjects({
        builder_id: builderId,
        budget_min_inr: filters.budgetMinInr,
        budget_max_inr: filters.budgetMaxInr,
        locations: filters.locations ? splitCsv(filters.locations) : undefined,
        bhks: filters.bhks ? splitCsv(filters.bhks) : undefined,
        project_types: filters.projectTypes ? splitCsv(filters.projectTypes) : undefined,
        purpose: filters.purpose,
        ...(filters.searchText ? { search_text: filters.searchText } : {}),
        max_results: filters.maxResults ?? 5,
      });
      return {
        matches: resp.matches.map((m) => ({
          project_id: m.project_id,
          name: m.name,
          micro_market: m.micro_market,
          starting_price_inr: m.starting_price_inr,
          starting_price_display: m.starting_price_display,
          match_reasons: m.match_reasons,
          project_type: m.project_type,
        })),
        expandedLocations: resp.expanded_locations ?? [],
        noMatchReasoning: resp.no_match_reasoning ?? '',
      };
    },

    async catalog(builderId) {
      const resp = await crm.searchProjects({ builder_id: builderId, max_results: 50 });
      const prices = resp.matches.map((m) => m.starting_price_inr).filter((p) => p > 0);
      return {
        priceMinInr: prices.length ? Math.min(...prices) : 0,
        priceMaxInr: prices.length ? Math.max(...prices) : 0,
        projectTypes: [...new Set(resp.matches.map((m) => m.project_type ?? 'project'))],
        microMarkets: [...new Set(resp.matches.map((m) => m.micro_market))],
        total: resp.matches.length,
        sample: resp.matches.slice(0, 10).map((m) => ({
          name: m.name,
          startingPriceDisplay: m.starting_price_display || formatInr(m.starting_price_inr),
        })),
      };
    },

    async projectDetail(_builderId, nd, projectId) {
      try {
        const ctx = await crm.conversationContext(nd);
        const p = ctx.project;
        if (p && p.project_id === projectId) {
          const faqs = (ctx.faqs ?? [])
            .map((f) => ({
              questionKey: f.question_key ?? '',
              question: f.canonical_question ?? '',
              answer: f.approved_answer ?? '',
            }))
            .filter((f) => f.answer);
          const configurations = (ctx.units ?? [])
            .map((u) => ({
              unitType: u.unit_type ?? '',
              priceDisplay: u.price_display ?? (u.price_min_paise ? formatInr(Math.round(u.price_min_paise / 100)) : ''),
              priceMinInr: u.price_min_paise ? Math.round(u.price_min_paise / 100) : 0,
            }))
            .filter((u) => u.unitType);
          return {
            projectId: p.project_id,
            name: p.name,
            microMarket: p.micro_market,
            ...(p.summary ? { summary: p.summary } : {}),
            ...(p.rera_number ? { reraNumber: p.rera_number } : {}),
            ...(p.possession_date ? { possession: formatYearMonth(p.possession_date) } : {}),
            ...(p.khata_type ? { khata: p.khata_type } : {}),
            ...(p.na_status ? { naStatus: p.na_status } : {}),
            ...(p.ec_status ? { ecStatus: p.ec_status } : {}),
            ...(p.loan_eligibility ? { loanEligibility: p.loan_eligibility } : {}),
            startingPriceDisplay: p.entry_price_band,
            ...(faqs.length ? { faqs } : {}),
            ...(configurations.length ? { configurations } : {}),
            ...(mapLocationIntel(ctx.location_intelligence) ? { location: mapLocationIntel(ctx.location_intelligence) } : {}),
          };
        }
      } catch {
        /* fall through to getProject */
      }
      try {
        const p = await crm.getProject(projectId);
        return {
          projectId: p.project_id,
          name: p.name,
          microMarket: p.micro_market,
          summary: p.summary,
          reraNumber: p.rera_number,
          possession: p.possession_date ? formatYearMonth(p.possession_date) : undefined,
          projectType: p.project_type,
          startingPriceDisplay: p.entry_price_band,
          khata: p.khata_type,
          naStatus: p.na_status,
          ecStatus: p.ec_status,
          loanEligibility: p.loan_eligibility,
        };
      } catch {
        return null;
      }
    },

    async pricing(_builderId, nd, projectId, unitType) {
      try {
        const q = await crm.pricingQuote({
          project_id: projectId,
          conversation_id: nd,
          unit_type: unitType,
        });
        const ctx = await crm.conversationContext(nd).catch(() => null);
        const name = ctx?.project?.name ?? projectId;
        const components = (q.components_quoted ?? []).map((c) => ({
          label: c.label,
          value: c.value,
        }));
        const withheld = (q.components_withheld ?? []).map((c) => ({
          label: c.label,
          redirectHint: c.redirect_hint ?? '',
        }));
        let startingDisplay = ctx?.project?.entry_price_band?.trim() || undefined;
        if (!components.length && ctx?.units?.length) {
          const priced = ctx.units
            .map((u) => ({
              display: u.price_display ?? (u.price_min_paise ? formatInr(Math.round(u.price_min_paise / 100)) : ''),
            }))
            .filter((u) => u.display);
          if (priced[0]?.display) {
            const display = priced[0].display.replace(/^from\s+/i, '').trim();
            startingDisplay = startingDisplay || display;
            components.push({ label: 'Starting from', value: display });
          }
        }
        if (!components.length && startingDisplay) {
          components.push({
            label: 'Starting from',
            value: startingDisplay.replace(/^from\s+/i, '').trim(),
          });
        }
        return {
          projectName: name,
          components,
          ...(startingDisplay ? { startingDisplay } : {}),
          ...(withheld.length ? { withheld } : {}),
        };
      } catch {
        return null;
      }
    },

    async landedCost(_builderId, nd, projectId, unitType) {
      try {
        const r = await crm.landedCost({ project_id: projectId, conversation_id: nd, unit_type: unitType });
        if (!r?.base_price_display) return null;
        const ctx = await crm.conversationContext(nd).catch(() => null);
        return {
          projectName: ctx?.project?.name ?? projectId,
          unitType,
          baseDisplay: r.base_price_display,
          oneTime: (r.one_time_charges ?? []).map((c) => ({ label: c.label, display: c.amount_display ?? '' })).filter((c) => c.display),
          recurring: (r.recurring_charges ?? []).map((c) => ({ label: c.label, display: c.amount_display ?? '' })).filter((c) => c.display),
          totalDisplay: r.total_display ?? '',
          ...(r.disclaimer ? { disclaimer: r.disclaimer } : {}),
        };
      } catch {
        return null;
      }
    },

    async compare(nd, projectIds) {
      try {
        const resp = await crm.compareProjects({ conversation_id: nd, project_ids: projectIds });
        return {
          tableText: resp.table_text ?? '',
          projects: resp.projects ?? [],
          ...(resp.matrix?.projects?.length && resp.matrix.rows?.length
            ? {
                matrix: {
                  projects: resp.matrix.projects.map((p) => ({
                    project_id: p.project_id,
                    name: p.name,
                  })),
                  rows: resp.matrix.rows.map((r) => ({
                    ...(r.key ? { key: r.key } : {}),
                    label: r.label,
                    values: r.values,
                  })),
                },
              }
            : {}),
        };
      } catch {
        return null;
      }
    },

    async priceBasis(_builderId, nd, projectId, unitType) {
      if (unitType) {
        try {
          const r = await crm.landedCost({ project_id: projectId, conversation_id: nd, unit_type: unitType });
          if (r && typeof r.base_price_low_inr === 'number' && r.base_price_low_inr > 0) {
            return { priceInr: r.base_price_low_inr, display: r.base_price_display ?? formatInr(r.base_price_low_inr) };
          }
        } catch {
          /* fall through */
        }
      }
      try {
        const ctx = await crm.conversationContext(nd);
        const prices = (ctx.units ?? [])
          .map((u) => Math.round((u.price_min_paise ?? 0) / 100))
          .filter((p) => p > 0);
        if (prices.length) {
          const p = Math.min(...prices);
          return { priceInr: p, display: formatInr(p) };
        }
      } catch {
        /* honest null */
      }
      return null;
    },

    async listUnits(projectId) {
      try {
        const resp = await crm.listProjectUnits(projectId);
        return (resp.units ?? [])
          .filter((u) => u.is_available !== 0)
          .map((u) => ({
            unitType: u.unit_type,
            priceDisplay: u.price_display,
            priceMinInr: 0,
          }));
      } catch {
        return [];
      }
    },

    async mediaShare(nd, projectId, assetKind, unitType) {
      try {
        const resp = await crm.mediaShare({
          project_id: projectId,
          conversation_id: nd,
          asset_kind: assetKind,
          ...(unitType ? { unit_type_filter: unitType } : {}),
        });
        return {
          allowed: resp.allowed,
          ...(resp.asset?.title ? { title: resp.asset.title } : {}),
          ...(resp.asset?.cdn_url ? { cdnUrl: resp.asset.cdn_url } : {}),
          ...(resp.asset?.asset_kind ? { assetKind: resp.asset.asset_kind } : {}),
          ...(resp.reason ? { reason: resp.reason } : {}),
          ...(resp.redirect_hint ? { redirectHint: resp.redirect_hint } : {}),
        };
      } catch {
        return null;
      }
    },

    async conversationContext(nd) {
      try {
        return await crm.conversationContext(nd);
      } catch {
        return null;
      }
    },

    async objectionContext(nd) {
      try {
        const ctx = await crm.conversationContext(nd);
        const playbooks = (ctx.objection_playbooks ?? []).map((p) => ({
          topic: (p.objection_topic ?? '').toLowerCase(),
          reframeAngles: parseJsonArray(p.reframe_angles),
          escalateAfter: typeof p.escalate_after === 'number' ? p.escalate_after : 3,
        }));
        return {
          playbooks,
          ...(ctx.builder?.escalation_phone ? { escalationPhone: ctx.builder.escalation_phone } : {}),
        };
      } catch {
        return null;
      }
    },

    async siteVisitsItinerary(nd) {
      try {
        const r = await crm.siteVisitsItinerary(nd);
        const out: StoredVisit[] = [];
        for (const plan of r.plans ?? []) {
          const c = (plan.collected ?? {}) as Record<string, unknown>;
          const iso = String(c.proposed_iso_datetime ?? c.visit_iso ?? '');
          const label = String(c.human_label ?? c.visit_label ?? '');
          if (!iso && !label) continue;
          out.push({
            projectId: String(c.project_id ?? ''),
            projectName: String(c.project_name ?? ''),
            iso,
            label,
            confirmed: c.confirmed === true || plan.status === 'completed',
          });
        }
        return out;
      } catch {
        return [];
      }
    },

    async builder(builderId) {
      try {
        const r = await crm.getBuilder(builderId);
        const b = r.builder;
        if (!b) return null;
        return {
          siteVisitHours: b.site_visit_hours || 'Mon–Sun, 9am–7pm',
          ...(b.name ? { name: b.name } : {}),
          ...(b.escalation_phone ? { escalationPhone: b.escalation_phone } : {}),
        };
      } catch {
        return null;
      }
    },

    async recordVisit(ids, visit) {
      try {
        const created = await crm.createPlan({
          conversation_id: ids.ndConversationId,
          buyer_phone: ids.buyerPhone,
          builder_id: ids.builderId,
          goal: 'site_visits',
          steps: [{ id: 'visit_confirmed', kind: 'book_visit', status: 'completed' }],
          current_step: 'visit_confirmed',
          collected: {
            project_id: visit.projectId,
            project_name: visit.projectName,
            proposed_iso_datetime: visit.iso,
            human_label: visit.label,
            confirmed: true,
          },
        });
        if (!created.ok) return false;
        await crm.patchPlan(created.plan_id, { status: 'completed' });
        return true;
      } catch {
        return false;
      }
    },

    async bootstrapContext(nd) {
      const [ctx, ledger] = await Promise.all([
        crm.conversationContext(nd, 12).catch(() => null),
        crm.turnLedgerContext(nd).catch(() => null),
      ]);
      const recentMessages = (ctx?.recent_messages ?? []).map((m) => ({
        role: m.direction === 'inbound' ? ('buyer' as const) : ('bot' as const),
        text: m.content,
        atMs: m.created_at,
      }));
      const returning = ctx?.returning_buyer;
      return {
        ...(returning
          ? {
              returningBuyer: {
                buyerName: returning.buyer_name,
                daysSinceLastSeen: returning.days_since_last_seen,
                ...(returning.last_project_id ? { lastProjectId: returning.last_project_id } : {}),
              },
            }
          : {}),
        ...(ctx?.builder
          ? { builderPersona: { botName: ctx.builder.bot_name, preferredTone: ctx.builder.preferred_tone } }
          : {}),
        recentMessages,
        rejectedProjectIds: ledger?.rejected_project_ids ?? [],
        turnIndex: ledger?.next_turn_index ?? 1,
      };
    },

    async geoAreasInRegion(region, builderId) {
      try {
        const r = await crm.areasInRegion(region, builderId);
        return (r.areas ?? []).map((a) => ({ name: a.name, distanceKm: a.distance_km }));
      } catch {
        return [];
      }
    },

    async resolveGeo(text) {
      try {
        const r = await crm.resolveGeo(text);
        if (!r.resolved || r.lat == null || r.lng == null) return null;
        return { lat: r.lat, lng: r.lng };
      } catch {
        return null;
      }
    },

    async projectCoords(builderId) {
      try {
        const resp = await crm.searchProjects({ builder_id: builderId, max_results: 50 });
        return (resp.matches ?? [])
          .filter((m) => m.lat != null && m.lng != null)
          .map((m) => ({ projectId: m.project_id, lat: m.lat!, lng: m.lng! }));
      } catch {
        return [];
      }
    },

    async faqLookup(projectId, questionKey) {
      try {
        const r = await crm.faqLookup(projectId, questionKey);
        if (!r.faq?.approved_answer) return null;
        return {
          question: r.faq.canonical_question,
          answer: r.faq.approved_answer,
        };
      } catch {
        return null;
      }
    },

    async getProfile(builderId, buyerPhone) {
      try {
        const r = await crm.getProfile(builderId, buyerPhone);
        return r.facts ?? {};
      } catch {
        return {};
      }
    },
  };
}

export function nayadeskCrm(crm: NayaDeskClient): EngineCrm {
  return {
    async ensureLead(builderId, buyerPhone) {
      const resp = await crm.upsertLead({ builder_id: builderId, buyer_phone: buyerPhone });
      return { conversationId: resp.conversation_id };
    },
    async appendMessage(conversationId, direction, content, meta) {
      await crm.appendMessage(conversationId, { direction, content });
      void meta;
    },
    async updateFacts(conversationId, facts) {
      const patch: Record<string, string> = {};
      if (facts.buyer_name) patch.buyer_name = facts.buyer_name;
      if (facts.bhk_preference) patch.bhk_preference = facts.bhk_preference;
      if (facts.budget_inr) patch.budget_inr = facts.budget_inr;
      if (facts.visit_date_pref) patch.visit_date_pref = facts.visit_date_pref;
      if (facts.purpose) patch.purpose = facts.purpose;
      if (Object.keys(patch).length) await crm.patchFacts(conversationId, patch);
      if (facts.location_pref) {
        await crm.applyStateWrites(conversationId, [{ op: 'set_slot', slot: 'location', value: facts.location_pref }]);
      }
    },
    async commitProject(conversationId, projectId) {
      await crm.commitProject(conversationId, projectId);
    },
    async releaseProject(conversationId) {
      await crm.releaseProject(conversationId);
    },
    async syncShortlist(conversationId, projectIds) {
      if (!projectIds.length) return;
      await crm.applyStateWrites(conversationId, [
        { op: 'set_shortlist_project_ids', project_ids: projectIds.slice(0, 3) },
      ]);
    },
    async syncMatching(conversationId, projectIds) {
      if (!projectIds.length) return;
      await crm.applyStateWrites(conversationId, [
        { op: 'set_matching_project_ids', project_ids: projectIds.slice(0, 10) },
      ]);
    },
    async setStage(conversationId, stage) {
      await crm.patchStage(conversationId, stage);
    },
    async appendSharedFact(conversationId, factKind, projectId, turnIndex) {
      await crm.applyStateWrites(conversationId, [
        {
          op: 'append_shared_fact',
          fact: { fact_kind: factKind, project_id: projectId, shared_at_turn: turnIndex },
        },
      ]);
    },
    async appendTurnLedger(entry) {
      await crm.appendTurnLedger({
        conversation_id: entry.conversationId,
        turn_index: entry.turnIndex,
        builder_id: entry.builderId,
        buyer_phone: entry.buyerPhone,
        created_at: Date.now(),
        buyer_text: entry.buyerText,
        composer: 'converse_engine',
        reply_text: entry.reply,
        snapshot_in: { phase: entry.phase, goal: entry.goal },
        resolved_intent: { goal: entry.goal },
        action_plan: {},
        offered_project_ids: entry.offeredProjectIds ?? [],
        disclosed_facts: [],
        verify: { grounding: 'pass' },
        tool_runs: entry.tools.map((name) => ({
          name,
          args_summary: '',
          success: true,
          latency_ms: 0,
        })),
      });
    },
    async postJourneySignals(builderId, buyerPhone, conversationId, signals, extras) {
      await crm.postJourneySignals({
        builder_id: builderId,
        buyer_phone: buyerPhone,
        conversation_id: conversationId,
        signals,
        ...(extras?.shortlistAdd ? { shortlist_add: extras.shortlistAdd } : {}),
        ...(extras?.rejectedAdd ? { rejected_add: extras.rejectedAdd } : {}),
      });
    },
    async postJourneyTurnSnapshot(builderId, buyerPhone, conversationId, goal, phase) {
      await crm.postJourneyTurnSnapshot({
        builder_id: builderId,
        buyer_phone: buyerPhone,
        conversation_id: conversationId,
        turn_goal: goal,
        strategist_reason: phase,
        matched_rules: [],
        snapshot: { phase, goal },
      });
    },
    async postProfileObservations(builderId, buyerPhone, conversationId, observations) {
      await crm.postProfileObservations({ builder_id: builderId, buyer_phone: buyerPhone, conversation_id: conversationId, observations });
    },
    async postChoiceEvent(builderId, buyerPhone, conversationId, matches, constraints) {
      await crm.postChoiceEvent({
        builder_id: builderId,
        buyer_phone: buyerPhone,
        conversation_id: conversationId,
        engine_status: 'ok',
        eligible: matches.map((m) => ({ project_id: m.projectId, name: m.name })),
        stretch: [],
        constraints,
      });
    },
    async postChoiceResponse(conversationId, responseText, responseIntent) {
      await crm.postChoiceResponse({
        conversation_id: conversationId,
        response_text: responseText,
        ...(responseIntent ? { response_intent: responseIntent } : {}),
      });
    },
    async deleteBuyerMemory(conversationId) {
      await crm.deleteBuyerMemory(conversationId);
    },
    async mirrorMemory(conversationId) {
      await crm.mirrorMemory(conversationId);
    },
  };
}
