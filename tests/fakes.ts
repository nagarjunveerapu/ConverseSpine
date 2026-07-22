import type { EngineCrm, EngineData, EngineDeps, EngineStore } from '../src/engine/ports.js';
import { noopEngineLlm } from '../src/engine/adapters/llm.js';
import type { SemanticNluPort, SemanticContext } from '../src/engine/adapters/semantic-nlu.js';
import { shouldQueryProjectVectors } from '../src/engine/adapters/semantic-nlu.js';
import { classifyTurnIntent } from '../src/engine/turn-intent/classify.js';
import type { Env } from '../src/env.js';
import type { CatalogEnvelope, Match, OfferedProject, SearchFilters } from '../src/engine/types.js';

interface P {
  id: string;
  name: string;
  market: string;
  type: string;
  priceInr: number;
  display: string;
}

const LOKATIONS: readonly P[] = [
  { id: 'ayana', name: 'Ayana', market: 'Sakleshpur', type: 'managed_plantation_estate', priceInr: 2_495_000, display: '₹24.95 L' },
  {
    id: 'krishnaja',
    name: 'Krishnaja Greens',
    market: 'Virajpet',
    type: 'managed_plantation_estate',
    priceInr: 3_900_000,
    display: '₹39 L',
  },
  {
    id: 'clarks',
    name: 'Clarks Exotica',
    market: 'North Bangalore',
    type: 'villa',
    priceInr: 7_500_000,
    display: '₹75 L',
  },
  {
    id: 'coorg-estate',
    name: 'Coorg Hills Estate',
    market: 'Coorg',
    type: 'managed_plantation_estate',
    priceInr: 4_800_000,
    display: '₹48 L',
  },
  { id: 'eldorado', name: 'Brigade Eldorado', market: 'North Bangalore', type: 'apartment', priceInr: 6_500_000, display: '₹65 L' },
  { id: 'cornerstone', name: 'Brigade Cornerstone', market: 'Devanahalli', type: 'apartment', priceInr: 5_200_000, display: '₹52 L' },
  { id: 'orchards', name: 'Brigade Orchards', market: 'Sarjapur', type: 'apartment', priceInr: 8_000_000, display: '₹80 L' },
];

/** Test double for PROJECT_VECTORS — catalog keyword match, not production logic. */
function matchProjectsFromCatalog(text: string): OfferedProject[] {
  const clauses = /\band\b/i.test(text)
    ? text.split(/\band\b/i).map((p) => p.trim()).filter((p) => p.length >= 3)
    : [text];
  const byId = new Map<string, OfferedProject>();
  for (let clause of clauses) {
    clause = clause.replace(/^.*?\bcompare\b\s*/i, '').trim();
    clause = clause.replace(/\bkirshnaja\b/gi, 'krishnaja');
    const lc = clause.toLowerCase();
    for (const p of LOKATIONS) {
      const name = p.name.toLowerCase();
      // Skip brand-only tokens (brigade/lokations) — they match every sibling project.
      const tokens = name
        .replace(/^(brigade|lokations)\s+/i, '')
        .split(/\s+/)
        .filter((t) => t.length >= 4);
      if (lc.includes(name) || tokens.some((t) => lc.includes(t))) {
        byId.set(p.id, { projectId: p.id, name: p.name });
      }
    }
  }
  return [...byId.values()];
}

function fakeSemanticNlu(): SemanticNluPort {
  return {
    async enrich(text, _builderId, ex, ctx) {
      // Mirror production: partial namedProjects (1 of 2) still allows vector completion.
      if ((ex.namedProjects?.length ?? 0) >= 2) return ex;
      if (!shouldQueryProjectVectors(text, ex, ctx)) return ex;
      const named = matchProjectsFromCatalog(text);
      return named.length ? { ...ex, namedProjects: named } : ex;
    },
  };
}

function toMatch(p: P): Match {
  return {
    projectId: p.id,
    name: p.name,
    microMarket: p.market,
    startingPriceInr: p.priceInr,
    startingPriceDisplay: p.display,
    matchReasons: ['fits your ask'],
    projectType: p.type,
  };
}

function filterCatalog(f: SearchFilters): P[] {
  let ms = LOKATIONS.slice();
  if (f.searchText) {
    const q = f.searchText.toLowerCase();
    ms = ms.filter((p) => {
      const name = p.name.toLowerCase();
      const first = name.split(/\s+/)[0] ?? '';
      return name.includes(q) || q.includes(first);
    });
  }
  if (f.projectTypes) {
    const want = f.projectTypes.toLowerCase();
    ms = ms.filter(
      (p) =>
        p.type.toLowerCase().includes(want) ||
        want.includes(p.type.toLowerCase()) ||
        (want.includes('plantation') && p.type.includes('plantation')) ||
        (want.includes('villa') && p.type.includes('villa')),
    );
  }
  if (f.locations) {
    const loc = f.locations.toLowerCase();
    ms = ms.filter(
      (p) =>
        p.market.toLowerCase().includes(loc) ||
        loc.includes(p.market.toLowerCase()) ||
        loc.includes('coorg') ||
        (loc.includes('bangalore') && p.market.toLowerCase().includes('bangalore')) ||
        (loc.includes('coorg') && p.market.toLowerCase().includes('sakleshpur')),
    );
  }
  if (f.budgetMaxInr !== undefined) ms = ms.filter((p) => p.priceInr <= f.budgetMaxInr!);
  ms.sort((a, b) => a.priceInr - b.priceInr);
  return ms.slice(0, f.maxResults ?? 3);
}

function projectDetailFor(id: string) {
  const p = LOKATIONS.find((x) => x.id === id);
  return p
    ? {
        projectId: p.id,
        name: p.name,
        microMarket: p.market,
        reraNumber: 'PRM/KA/RERA/1251/446/2024',
        possession: 'Dec 2027',
        startingPriceDisplay: p.display,
        projectType: p.type,
        summary: 'Managed coffee plantation estate in the Western Ghats.',
        ecStatus: 'Clear — no encumbrance on record for the estate parcels.',
        loanEligibility: 'HDFC, SBI, ICICI, Axis — subject to buyer credit.',
        location: {
          connectivitySummary: '2.5 hrs from Bangalore via NH75; nearest town Sakleshpur 12 km.',
          microMarketOverview: 'Rolling hills, coffee estates, cool climate year-round.',
          nearbyPois: ['Sakleshpur town', 'Bisle Ghat viewpoint', 'Hemavathi reservoir'],
          driveTimes: ['Bangalore: ~2.5 hrs', 'Mangalore: ~3 hrs'],
        },
      }
    : null;
}

export function fakeData(): EngineData & {
  holdsPlaced: Array<{ projectId: string; unitType: string; buyerName: string }>;
} {
  const visits: Array<{ projectId: string; projectName: string; iso: string; label: string; confirmed: boolean }> = [];
  const holds: Array<{ projectId: string; unitType: string; buyerName: string }> = [];
  return {
    holdsPlaced: holds,
    async search(_b, f) {
      return { matches: filterCatalog(f).map((p) => ({
        project_id: p.id,
        name: p.name,
        micro_market: p.market,
        starting_price_inr: p.priceInr,
        starting_price_display: p.display,
        match_reasons: ['fits'],
        project_type: p.type,
      })) };
    },
    async catalog(): Promise<CatalogEnvelope> {
      const prices = LOKATIONS.map((p) => p.priceInr);
      return {
        priceMinInr: Math.min(...prices),
        priceMaxInr: Math.max(...prices),
        projectTypes: ['plantation', 'villa', 'apartment'],
        microMarkets: [...new Set(LOKATIONS.map((p) => p.market))],
        total: LOKATIONS.length,
        sample: LOKATIONS.map((p) => ({ name: p.name, startingPriceDisplay: p.display })),
      };
    },
    async projectNames() {
      return LOKATIONS.map((p) => ({ projectId: p.id, name: p.name }));
    },
    async projectDetail(_b, _nd, id) {
      return projectDetailFor(id);
    },
    async pricing(_b, _nd, id) {
      const p = LOKATIONS.find((x) => x.id === id);
      return p
        ? {
            projectName: p.name,
            components: [{ label: 'Starting from', value: p.display.replace(/^from\s+/i, '').trim() || p.display }],
            startingDisplay: p.display,
          }
        : null;
    },
    async landedCost(_b, _nd, id, unitType) {
      const p = LOKATIONS.find((x) => x.id === id);
      return p
        ? {
            projectName: p.name,
            unitType,
            baseDisplay: p.display,
            oneTime: [{ label: 'Stamp duty', display: '5%' }],
            recurring: [],
            totalDisplay: p.display,
          }
        : null;
    },
    async compare(_nd, ids) {
      const ps = ids.map((id) => LOKATIONS.find((x) => x.id === id)).filter(Boolean) as P[];
      if (ps.length < 2) return null;
      return {
        tableText: ps.map((p) => `${p.name}: ${p.market}, from ${p.display}`).join('\n'),
        projects: ps.map((p) => ({ name: p.name })),
        // Mirror the Desk compare_matrix contract (fixed rows × project columns).
        matrix: {
          projects: ps.map((p) => ({ project_id: p.id, name: p.name })),
          rows: [
            { key: 'location', label: 'Location', values: ps.map((p) => p.market) },
            { key: 'configurations', label: 'Configurations', values: ps.map(() => '—') },
            { key: 'starting_price', label: 'Starting price', values: ps.map((p) => p.display) },
            { key: 'possession', label: 'Possession', values: ps.map(() => 'Dec 2027') },
          ],
        },
      };
    },
    async priceBasis(_b, _nd, id) {
      const p = LOKATIONS.find((x) => x.id === id);
      return p ? { priceInr: p.priceInr, display: p.display } : null;
    },
    async listUnits(id) {
      const p = LOKATIONS.find((x) => x.id === id);
      if (!p) return [];
      if (p.type.includes('plantation') || p.type.includes('plot')) {
        return [
          {
            unitType: 'Quarter acre',
            priceDisplay: p.display,
            priceMinInr: p.priceInr,
            sizeDisplay: '10,890 sqft',
            sizeMinSqft: 10890,
            sizeMaxSqft: 10890,
          },
        ];
      }
      return [
        {
          unitType: '2 BHK',
          priceDisplay: p.display,
          priceMinInr: p.priceInr,
          sizeDisplay: '1050-1180 sqft',
          sizeMinSqft: 1050,
          sizeMaxSqft: 1180,
        },
        {
          unitType: '3 BHK',
          priceDisplay: p.display,
          priceMinInr: Math.round(p.priceInr * 1.2),
          sizeDisplay: '1400-1550 sqft',
          sizeMinSqft: 1400,
          sizeMaxSqft: 1550,
        },
      ];
    },
    async mediaShare(_nd, _pid, assetKind) {
      return {
        allowed: true,
        title: assetKind === 'brochure' ? 'Project brochure' : 'Floor plan',
        cdnUrl: 'https://cdn.example/brochure.pdf',
        assetKind,
      };
    },
    async marketIntel(_microMarket) {
      return null; // fakes have no approved corridor intel — honest absence
    },
    async conversationContext(_nd) {
      return {
        conversation: {
          conversation_id: 'nd:test',
          builder_id: 'lokations',
          buyer_phone: '+919999999999',
          buyer_name: '',
          status: 'engaged',
          bhk_preference: '',
          budget_inr: '',
          visit_date_pref: '',
          location_pref: '',
          project_id: 'ayana',
          purpose: '',
          pending_action: '',
          pending_action_payload: '',
          project_state: 'focused',
          shortlist_project_ids: '',
          turn_count: 1,
        },
        project: {
          project_id: 'ayana',
          name: 'Ayana',
          micro_market: 'Sakleshpur',
          rera_number: 'PRM/KA/RERA/1251/446/2024',
          entry_price_band: '₹24.95 L',
        },
        builder: { name: 'Lokations', bot_name: 'Naya', bot_persona: '', bot_signature: '', preferred_tone: 'warm' },
      };
    },
    async objectionContext() {
      return {
        playbooks: [{ topic: 'price', reframeAngles: ['Entry price reflects the land quality.'], escalateAfter: 3 }],
      };
    },
    async siteVisitsItinerary() {
      return visits.slice();
    },
    async builder() {
      return { siteVisitHours: 'Mon–Sun, 9am–7pm', name: 'Lokations' };
    },
    async recordVisit(_ids, v) {
      visits.push({ ...v, confirmed: true });
      return true;
    },
    async placeHold(_ids, hold) {
      holds.push({ projectId: hold.projectId, unitType: hold.unitType, buyerName: hold.buyerName ?? '' });
      // W7 — queue:true lands on the waitlist (Desk 202) instead of a hold.
      if (hold.queue) return { ok: true, waiting: true, position: 1 };
      // Fixed expiry keeps assertions deterministic (24h past the fake epoch).
      return { ok: true, expiresAt: 1_750_000_000_000 + 24 * 60 * 60 * 1000, unitNumber: 'A-101' };
    },
    async bootstrapContext() {
      return { recentMessages: [], rejectedProjectIds: [], turnIndex: 1 };
    },
    async geoAreasInRegion(_region) {
      return [{ name: 'Sakleshpur', distanceKm: 0 }];
    },
    async resolveGeo(text) {
      const key = text.trim().toLowerCase();
      if (key.includes('yelahanka')) return { lat: 13.1007, lng: 77.5963 };
      if (key.includes('whitefield')) return { lat: 12.969, lng: 77.749 };
      return null;
    },
    async projectCoords(_builderId) {
      return [
        { projectId: 'cornerstone', lat: 13.18, lng: 77.68 },
        { projectId: 'eldorado', lat: 13.139, lng: 77.658 },
        { projectId: 'ayana', lat: 12.944, lng: 75.784 },
        { projectId: 'krishnaja', lat: 12.254, lng: 75.923 },
      ];
    },
    async faqLookup(_pid, key) {
      if (key === 'amenities') return { question: 'Amenities?', answer: 'Clubhouse and pool on file.' };
      if (key === 'rental_yield') {
        return {
          question: 'What rental yield can I expect?',
          answer: 'Estimated 3–4% net rental yield — estimate only, not a guarantee.',
        };
      }
      if (key === 'possession') {
        return { question: 'When is possession?', answer: 'Possession is phased through 2028.' };
      }
      return null;
    },
    async getProfile() {
      return {};
    },
  };
}

export function fakeCrm(): EngineCrm & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ensureLead(_b, phone) {
      calls.push(`lead:${phone}`);
      return { conversationId: `nd:${phone}` };
    },
    async appendMessage() {},
    async updateFacts() {},
    async commitProject(_nd, pid) {
      calls.push(`commit:${pid}`);
    },
    async releaseProject(_nd) {
      calls.push('release');
    },
    async syncShortlist(_nd, ids) {
      calls.push(`shortlist:${ids.join(',')}`);
    },
    async syncMatching(_nd, ids) {
      calls.push(`matching:${ids.join(',')}`);
    },
    async setStage(_nd, stage, opts) {
      calls.push(`stage:${stage}${opts?.onlyForward ? ':fwd' : ''}`);
    },
    async appendSharedFact(_nd, kind, pid) {
      calls.push(`shared:${kind}:${pid}`);
    },
    async appendTurnLedger() {},
    async postJourneySignals() {},
    async postJourneyTurnSnapshot() {},
    async postProfileObservations() {},
    async postChoiceEvent() {},
    async postChoiceResponse() {},
    async deleteBuyerMemory(_nd) {
      calls.push('delete-memory');
    },
    async mirrorMemory() {},
  };
}

export function fakeStore(): EngineStore {
  const mem = new Map<string, import('../src/engine/types.js').ConversationState>();
  return {
    async load(id) {
      return mem.get(id) ?? null;
    },
    async save(s) {
      mem.set(s.convId, s);
    },
    async logTurn() {},
  };
}

export function fakeDeps(): EngineDeps {
  return {
    data: fakeData(),
    crm: fakeCrm(),
    llm: noopEngineLlm(),
    semantic: fakeSemanticNlu(),
    store: fakeStore(),
    clock: { nowMs: () => 1_700_000_000_000, nowIso: () => '2026-07-05T00:00:00.000Z' },
    turnIntent: {
      classify: (input) => classifyTurnIntent({} as Env, input),
    },
  };
}
