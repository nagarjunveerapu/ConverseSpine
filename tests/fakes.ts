import type { EngineCrm, EngineData, EngineDeps, EngineStore } from '../src/engine/ports.js';
import { noopEngineLlm } from '../src/engine/adapters/llm.js';
import { noopSemanticNlu } from '../src/engine/adapters/semantic-nlu.js';
import { classifyTurnIntent } from '../src/engine/turn-intent/classify.js';
import type { Env } from '../src/env.js';
import type { CatalogEnvelope, Match, SearchFilters } from '../src/engine/types.js';

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
];

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
        location: {
          connectivitySummary: '2.5 hrs from Bangalore via NH75; nearest town Sakleshpur 12 km.',
          microMarketOverview: 'Rolling hills, coffee estates, cool climate year-round.',
          nearbyPois: ['Sakleshpur town', 'Bisle Ghat viewpoint', 'Hemavathi reservoir'],
          driveTimes: ['Bangalore: ~2.5 hrs', 'Mangalore: ~3 hrs'],
        },
      }
    : null;
}

export function fakeData(): EngineData {
  const visits: Array<{ projectId: string; projectName: string; iso: string; label: string; confirmed: boolean }> = [];
  return {
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
      const names = ids.map((id) => LOKATIONS.find((x) => x.id === id)?.name).filter(Boolean) as string[];
      if (names.length < 2) return null;
      return {
        tableText: names
          .map((n) => {
            const p = LOKATIONS.find((x) => x.name === n)!;
            return `${n}: ${p.market}, from ${p.display}`;
          })
          .join('\n'),
        projects: names.map((n) => ({ name: n })),
      };
    },
    async priceBasis(_b, _nd, id) {
      const p = LOKATIONS.find((x) => x.id === id);
      return p ? { priceInr: p.priceInr, display: p.display } : null;
    },
    async listUnits(id) {
      const p = LOKATIONS.find((x) => x.id === id);
      return p ? [{ unitType: 'Quarter acre', priceDisplay: p.display, priceMinInr: p.priceInr }] : [];
    },
    async mediaShare(_nd, _pid, assetKind) {
      return {
        allowed: true,
        title: assetKind === 'brochure' ? 'Project brochure' : 'Floor plan',
        cdnUrl: 'https://cdn.example/brochure.pdf',
        assetKind,
      };
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
    async faqLookup(_pid, key) {
      return key === 'amenities' ? { question: 'Amenities?', answer: 'Clubhouse and pool on file.' } : null;
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
    async setStage(_nd, stage) {
      calls.push(`stage:${stage}`);
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
    semantic: noopSemanticNlu(),
    store: fakeStore(),
    clock: { nowMs: () => 1_700_000_000_000, nowIso: () => '2026-07-05T00:00:00.000Z' },
    turnIntent: {
      classify: (input) => classifyTurnIntent({} as Env, input),
    },
  };
}
