import { NayaDeskError, type NayaDeskClient, type NdLocationIntelRow } from '../../crm/nayadesk-client.js';
import type { EngineCrm, EngineData, StoredVisit } from '../ports.js';
import type { LocationPoi, LocationPoiCategories } from '../types.js';
import { formatInr, formatCostValue, formatPossession, startingPriceDisplayFrom, phaseNoteFrom } from '../compose.js';
import {
  mapEnrichmentSummaryToUnitConfigs,
  mapLegacyUnitsToUnitConfigs,
} from '../unit-config.js';

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

/** Parse one Desk LI category column: JSON array of {name, distance_km, drive_minutes} (or plain strings). */
function parsePoiList(s: string | undefined): LocationPoi[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: LocationPoi[] = [];
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) {
        out.push({ name: item.trim() });
      } else if (item && typeof item === 'object') {
        const o = item as { name?: unknown; distance_km?: unknown; drive_minutes?: unknown };
        if (typeof o.name === 'string' && o.name.trim()) {
          out.push({
            name: o.name.trim(),
            ...(typeof o.distance_km === 'number' ? { distanceKm: o.distance_km } : {}),
            ...(typeof o.drive_minutes === 'number' ? { driveMinutes: o.drive_minutes } : {}),
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function poiDisplay(p: LocationPoi): string {
  const dist = p.distanceKm !== undefined ? `${p.distanceKm} km` : '';
  const drive = p.driveMinutes !== undefined ? `~${p.driveMinutes} min drive` : '';
  const extra = [dist, drive].filter(Boolean).join(', ');
  return extra ? `${p.name} (${extra})` : p.name;
}

/**
 * Map the Desk `location_intelligence` row into structured POI evidence.
 * Every category is a JSON array of Places-verified POIs (S1 — this mapper
 * previously read four field names Desk never served and was always empty).
 * Exported for tests only.
 */
export function mapLocationIntel(raw: NdLocationIntelRow | null | undefined) {
  if (!raw) return undefined;
  const categories = {
    schools: parsePoiList(raw.schools),
    hospitals: parsePoiList(raw.hospitals),
    metroStations: parsePoiList(raw.metro_stations),
    airports: parsePoiList(raw.airports),
    itParks: parsePoiList(raw.it_parks),
    malls: parsePoiList(raw.malls),
    transitStations: parsePoiList(raw.transit_stations),
    universities: parsePoiList(raw.universities),
    supermarkets: parsePoiList(raw.supermarkets),
    parks: parsePoiList(raw.parks),
  };
  const upcomingInfra = parsePoiList(raw.upcoming_infra).map((p) => poiDisplay(p));
  if (Object.values(categories).every((c) => c.length === 0) && upcomingInfra.length === 0) {
    return undefined;
  }
  // Legacy display strings — the Advisor project-detail panel renders these
  // (derived from the same verified POIs, not invented).
  const nearbyPois = [
    categories.schools[0],
    categories.hospitals[0],
    categories.malls[0],
    categories.itParks[0],
  ]
    .filter((p): p is LocationPoi => Boolean(p))
    .map(poiDisplay);
  const driveTimes = [
    categories.metroStations[0] ? `Metro (${poiDisplay(categories.metroStations[0])})` : '',
    categories.airports[0] ? `Airport (${poiDisplay(categories.airports[0])})` : '',
  ].filter(Boolean);
  return {
    ...Object.fromEntries(Object.entries(categories).filter(([, v]) => v.length > 0)),
    ...(upcomingInfra.length ? { upcomingInfra } : {}),
    ...(nearbyPois.length ? { nearbyPois } : {}),
    ...(driveTimes.length ? { driveTimes } : {}),
  } as LocationPoiCategories & { nearbyPois?: string[]; driveTimes?: string[] };
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
        ...(filters.conversationId ? { conversation_id: filters.conversationId } : {}),
        ...(filters.preferenceWeights ? { preference_weights: filters.preferenceWeights } : {}),
        ...(filters.commuteHub ? { commute_hub: filters.commuteHub } : {}),
        ...(filters.budgetTargetInr ? { budget_target_inr: filters.budgetTargetInr } : {}),
        ...(filters.askSizeSqft ? { ask_size_sqft: filters.askSizeSqft } : {}),
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
          ...(m.tradeoff_note ? { tradeoff_note: m.tradeoff_note } : {}),
          ...(m.dimension_fit ? { dimension_fit: m.dimension_fit } : {}),
          ...(m.dimension_gap ? { dimension_gap: m.dimension_gap } : {}),
        })),
        expandedLocations: resp.expanded_locations ?? [],
        // null (no locations sent) and missing (old Desk) both map to
        // undefined — only a real array may trigger the junk-locality drop.
        ...(Array.isArray(resp.recognized_locations)
          ? { recognizedLocations: resp.recognized_locations }
          : {}),
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

    async projectNames(builderId) {
      // 50 is the Desk search cap (projects.ts max_results.max(50)); enough for the
      // catalog. An unfiltered search returns all active projects for the builder.
      const resp = await crm.searchProjects({ builder_id: builderId, max_results: 50 });
      return resp.matches.map((m) => ({ projectId: m.project_id, name: m.name }));
    },

    async projectDetail(_builderId, nd, projectId) {
      try {
        const ctx = await crm.conversationContext(nd);
        const p = ctx.project;
        if (p && p.project_id === projectId) {
          // STRUCTURAL INVARIANT (over-answer fix): detail.faqs means "the FAQ
          // answers matched to THIS question" and fetchAnswer is its ONLY
          // writer (topic-keyed faqLookup hits). The adapter must never ship
          // the whole catalog here — that's what turned "tell me about X"
          // into a 600-word dump of every FAQ.
          const configurations = (ctx.units ?? [])
            .map((u) => ({
              unitType: u.unit_type ?? '',
              priceDisplay: u.price_display ?? (u.price_min_paise ? formatInr(Math.round(u.price_min_paise / 100)) : ''),
              priceMinInr: u.price_min_paise ? Math.round(u.price_min_paise / 100) : 0,
              // Band high end for the overview card (low–high from configs).
              ...(u.price_max_paise ? { priceMaxInr: Math.round(u.price_max_paise / 100) } : {}),
              // W7 — live holdable count per type (Desk #203); undefined = pre-#203 payload.
              ...(typeof u.holdable_units === 'number' ? { holdableUnits: u.holdable_units } : {}),
            }))
            .filter((u) => u.unitType);
          // W7 — one buyer-ready phase caveat from the journey composer output
          // (pre-RERA phases can hold/EOI but not book).
          const phaseNote = phaseNoteFrom(ctx.phase_journeys);
          const location = mapLocationIntel(ctx.location_intelligence);
          return {
            projectId: p.project_id,
            name: p.name,
            microMarket: p.micro_market,
            ...(p.summary ? { summary: p.summary } : {}),
            ...(p.rera_number ? { reraNumber: p.rera_number } : {}),
            // W4 — free-text possession normalised (no double periods/run-ons).
            ...(p.possession_date ? { possession: formatPossession(formatYearMonth(p.possession_date)) } : {}),
            ...(p.khata_type ? { khata: p.khata_type } : {}),
            ...(p.na_status ? { naStatus: p.na_status } : {}),
            ...(p.ec_status ? { ecStatus: p.ec_status } : {}),
            ...(p.loan_eligibility ? { loanEligibility: p.loan_eligibility } : {}),
            // W4 — ONE starting-price truth: min config price (same number the
            // search rail shows); the configured band is only the fallback.
            startingPriceDisplay: startingPriceDisplayFrom(
              configurations.map((u) => u.priceMinInr),
              p.entry_price_band,
            ),
            ...(configurations.length ? { configurations } : {}),
            ...(phaseNote ? { phaseNote } : {}),
            ...(location ? { location } : {}),
          };
        }
      } catch {
        /* fall through to getProject */
      }
      try {
        const p = await crm.getProject(projectId);
        // S1 — LI ships on the project GET too, so location answers work even
        // when conversation context is unavailable (e.g. advisor-door sessions
        // whose Desk conversation row differs from the engine's nd).
        const location = mapLocationIntel(p.location_intelligence);
        return {
          projectId: p.project_id,
          name: p.name,
          microMarket: p.micro_market,
          summary: p.summary,
          reraNumber: p.rera_number,
          possession: p.possession_date ? formatPossession(formatYearMonth(p.possession_date)) : undefined,
          projectType: p.project_type,
          // One price policy: route the band through the shared helper (no config
          // prices in this fallback branch, so it renders the band) instead of
          // emitting the raw band directly. Audit P0.2.
          startingPriceDisplay: startingPriceDisplayFrom([], p.entry_price_band),
          khata: p.khata_type,
          naStatus: p.na_status,
          ecStatus: p.ec_status,
          loanEligibility: p.loan_eligibility,
          ...(location ? { location } : {}),
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
        // W4 — format once, here: raw cost-sheet values ("499", "5") become
        // buyer-ready ("₹499", "5%") before any template sees them.
        const components = (q.components_quoted ?? []).map((c) => ({
          label: c.label,
          // Format by Desk's structured `kind` (per_sqft/percent/flat/info) —
          // never guess the unit from the label. Fixes "₹499" → "₹499/sqft".
          value: formatCostValue(c.label, c.value, c.kind),
        }));
        const withheld = (q.components_withheld ?? []).map((c) => ({
          label: c.label,
          redirectHint: c.redirect_hint ?? '',
        }));
        // One price policy: the starting figure is the min priced config
        // (formatInr), falling back to the band ONLY when no config is priced —
        // the config price must win over the coarse band, not the other way
        // round. Audit P0.2 (previously seeded from raw entry_price_band first).
        const configMinsInr = (ctx?.units ?? []).map((u) =>
          u.price_min_paise ? Math.round(u.price_min_paise / 100) : 0,
        );
        const startingDisplay =
          startingPriceDisplayFrom(configMinsInr, ctx?.project?.entry_price_band) || undefined;
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
      // Prefer #178 enrichment summary (size + price ranges by type).
      try {
        const summary = await crm.unitsEnrichmentSummary(projectId);
        const mapped = mapEnrichmentSummaryToUnitConfigs(summary);
        if (mapped.length) return mapped;
      } catch {
        /* route may 404 until nayadesk-dev deploys #178 — fall through */
      }
      try {
        const resp = await crm.listProjectUnits(projectId);
        return mapLegacyUnitsToUnitConfigs(resp.units ?? []);
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

    async marketIntel(microMarket) {
      const q = microMarket.trim();
      if (!q) return null;
      try {
        const r = await crm.marketIntel(q);
        return r.intel ?? null;
      } catch {
        return null; // transport failure = honest absence, never a thrown turn
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

    async placeHold(ids, hold) {
      try {
        const r = await crm.placeHold({
          project_id: hold.projectId,
          unit_type: hold.unitType,
          conversation_id: ids.ndConversationId,
          ...(hold.buyerName ? { buyer_name: hold.buyerName } : {}),
          ...(hold.queue ? { queue: true } : {}),
          ttl_minutes: hold.ttlMinutes ?? 24 * 60,
        });
        // W7 — queue:true may land on the waitlist (202 waiting) instead of a
        // hold; surface it so the confirmation copy is honest about which.
        if (r.status === 'waiting') {
          return { ok: true, waiting: true, ...(r.position ? { position: r.position } : {}) };
        }
        return {
          ok: true,
          ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
          ...(r.unit_number ? { unitNumber: r.unit_number } : {}),
        };
      } catch (err) {
        // 409 = no_units_available (type fully sold, or already_waiting) — an
        // expected outcome the copy must reflect; 404 = unknown type name.
        if (err instanceof NayaDeskError && (err.status === 409 || err.status === 404)) {
          return { ok: false, reason: 'none_available' };
        }
        return { ok: false, reason: 'error' };
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
        ledgerPrior: ledger?.prior ?? null,
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

    async resolveLocation(text) {
      try {
        const r = await crm.resolveGeo(text);
        if (!r.resolved) return { status: 'unresolved' };
        if (r.lat == null || r.lng == null) return { status: 'unavailable' };
        return {
          status: 'resolved',
          canonical: r.area_name?.trim() || text.trim(),
          lat: r.lat,
          lng: r.lng,
        };
      } catch {
        return { status: 'unavailable' };
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

export function nayadeskCrm(
  crm: NayaDeskClient,
  opts?: {
    /** Understanding Flywheel Wave A — when true, wires enqueueIntentReview so
     *  every turn feeds Desk's understanding board (UNDERSTANDING_CAPTURE). */
    understandingCapture?: boolean;
  },
): EngineCrm {
  return {
    async ensureLead(builderId, buyerPhone, channel) {
      const resp = await crm.upsertLead({
        builder_id: builderId,
        buyer_phone: buyerPhone,
        ...(channel ? { channel } : {}),
      });
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
    async setStage(conversationId, stage, opts) {
      await crm.patchStage(conversationId, stage, opts?.onlyForward);
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
        composer: entry.composer ?? 'converse_engine',
        reply_text: entry.reply,
        snapshot_in: entry.snapshotIn ?? { phase: entry.phase, goal: entry.goal },
        resolved_intent: entry.resolvedIntent ?? { goal: entry.goal },
        action_plan: entry.actionPlan ?? {},
        offered_project_ids: entry.offeredProjectIds ?? [],
        disclosed_facts: entry.disclosedFacts ?? [],
        verify: entry.verify ?? { grounding: 'pass' },
        tool_runs:
          entry.toolRuns ??
          entry.tools.map((name) => ({
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
    ...(opts?.understandingCapture
      ? {
          async enqueueIntentReview(p: {
            builderId: string;
            conversationId: string;
            buyerPhone: string;
            turnIndex: number;
            buyerText: string;
            botReply: string;
            recentMessages: Array<{ role: 'user' | 'bot'; text: string }>;
            silIntent: string;
            silScore: number;
            silBindSource: string;
            speechAct: string;
            language: string;
            projectFocus: string;
          }) {
            // Desk canonicalizes + clusters server-side (it owns the vocab).
            // The legacy embedder_*/llm_* voter fields stay at their schema
            // defaults (abstained) ON PURPOSE — see the port doc.
            await crm.enqueueIntentReview({
              builder_id: p.builderId,
              conversation_id: p.conversationId,
              buyer_phone: p.buyerPhone,
              turn_index: p.turnIndex,
              buyer_text: p.buyerText,
              bot_reply: p.botReply,
              recent_messages: p.recentMessages,
              sil_intent: p.silIntent,
              sil_score: p.silScore,
              sil_bind_source: p.silBindSource,
              speech_act: p.speechAct,
              language: p.language,
              project_focus: p.projectFocus,
              source: 'auto_turn',
            });
          },
        }
      : {}),
  };
}
