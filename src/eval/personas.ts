/** Synthetic buyer persona — generated fresh each eval run. */
import type { BuilderCatalog } from './catalog.js';

export interface BuyerProfile {
  id: string;
  name: string;
  phone: string;
  builder_id: string;
  /** What the buyer is trying to accomplish this session. */
  goal: string;
  bhk: string;
  budget: string;
  location: string;
  purpose: 'self_use' | 'investment';
  /** Communication style hints for the simulator. */
  style: 'direct' | 'chatty' | 'skeptical' | 'hinglish';
  /** Named project they may ask about (optional). */
  project_interest?: string;
  /** Max turns before judge runs. */
  max_turns: number;
  /** Builder catalog type — shapes opening message slots. */
  catalog_kind?: 'apartment' | 'plantation';
  /** Curated scenario id when using persona library. */
  scenario_id?: string;
  /** Fixed script for deterministic eval (overrides LLM sim). */
  script?: string[];
}

const FIRST_NAMES = ['Arjun', 'Priya', 'Rahul', 'Ananya', 'Vikram', 'Meera', 'Karthik', 'Sneha', 'Rohan', 'Divya'];

const DEFAULT_LOCATIONS = ['Whitefield', 'Sarjapur', 'Thanisandra', 'Electronic City', 'Hebbal'];
const DEFAULT_BUDGETS = ['60 lakh', '80 lakh', '1 cr', '1.2 cr', '1.5 cr'];
const DEFAULT_BHKS = ['2 BHK', '3 BHK'];
const DEFAULT_GOALS = [
  'Find a home within budget and book a site visit',
  'Compare options and get pricing',
  'Learn about a named project then decide on a visit',
  'Push back on price then still explore options',
  'Get legal/RERA info before committing to visit',
];

const PLANTATION_GOALS = [
  'Find a plantation investment within budget and book a site visit',
  'Compare estate options and get pricing',
  'Learn about Ayana then decide on a visit',
  'Ask about ROI then book a site visit',
];

export function generateBuyerProfile(
  seed?: number,
  builderId = 'lokations',
  catalog?: BuilderCatalog,
): BuyerProfile {
  const r = seededRandom(seed ?? Date.now());
  const name = pick(r, FIRST_NAMES);
  const id = `eval-${Math.floor(r() * 1e6)}`;
  const isPlantation = builderId === 'lokations' || catalog?.projects.some((p) =>
    /plantation|estate/i.test(p.name),
  );

  const locations =
    catalog?.locations.length ? catalog.locations : isPlantation
      ? ['Sakleshpur', 'Virajpet', 'Coorg', 'Chikmagalur']
      : DEFAULT_LOCATIONS;

  const projects = catalog?.projects.map((p) => p.name) ?? ['Ayana', 'Krishnaja Greens'];
  const budgets = isPlantation
    ? ['25 lakh', '40 lakh', '50 lakh', '80 lakh', '1 cr']
    : DEFAULT_BUDGETS;

  return {
    id,
    name,
    phone: `+9199${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
    builder_id: builderId,
    goal: pick(r, isPlantation ? PLANTATION_GOALS : DEFAULT_GOALS),
    bhk: pick(r, DEFAULT_BHKS),
    budget: pick(r, budgets),
    location: pick(r, locations),
    purpose: isPlantation || r() > 0.5 ? 'investment' : 'self_use',
    style: pick(r, ['direct', 'chatty', 'skeptical', 'hinglish'] as const),
    project_interest: r() > 0.35 ? pick(r, projects) : undefined,
    max_turns: 5 + Math.floor(r() * 4),
    catalog_kind: isPlantation ? 'plantation' : 'apartment',
  };
}

export function generateBuyerProfiles(
  count: number,
  builderId = 'lokations',
  catalog?: BuilderCatalog,
): BuyerProfile[] {
  const base = Date.now();
  return Array.from({ length: count }, (_, i) =>
    generateBuyerProfile(base + i * 997, builderId, catalog),
  );
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)]!;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Opening slots message — matches builder catalog shape. */
export function profileOpeningMessage(profile: BuyerProfile): string {
  if (profile.catalog_kind === 'plantation') {
    return `${profile.location} ${profile.budget} plantation investment`;
  }
  return `${profile.bhk} ${profile.location} ${profile.budget}`;
}
