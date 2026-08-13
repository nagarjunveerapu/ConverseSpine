/**
 * WhatsApp Advisor brief — same chip ladder as NayaAdvisor SPA.
 * Packer chrome only; ranking still goes through advisor-weights + Desk.
 */
import type { Constraints, ConversationState, ProbeKind } from '../engine/types.js';
import { derivedPriorityFromWorries } from '../engine/advisor-weights.js';
import { parseBudgetToInr } from '../engine/facts.js';

export const WA_BRIEF_PREFIX = 'wa.brief.';

export type WaBriefStep = Extract<
  ProbeKind,
  'purpose' | 'budget' | 'propertyType' | 'bhk' | 'location' | 'worries' | 'schools' | 'hub' | 'priority'
>;

export interface WaBriefPatch {
  constraints?: Partial<Constraints>;
  markAsked?: ProbeKind[];
  /** Keep prior location (hub/schools chips must not overwrite area). */
  preserveLocation?: boolean;
  /** Stay on BHK to allow a second size before Done. */
  stayOnBhk?: boolean;
}

export interface WaBriefRow {
  id: string;
  title: string;
  description?: string;
}

const PURPOSE_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.purpose.self_use', title: 'Self-use' },
  { id: 'wa.brief.purpose.investment', title: 'Investment' },
  { id: 'wa.brief.purpose.unsure', title: 'Not sure yet' },
];

const BUDGET_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.budget.40_50l', title: '₹40–50L' },
  { id: 'wa.brief.budget.50_70l', title: '₹50–70L' },
  { id: 'wa.brief.budget.70l_1cr', title: '₹70L–1 Cr' },
  { id: 'wa.brief.budget.1cr_plus', title: '₹1 Cr+' },
];

const TYPE_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.type.apartment', title: 'Apartment' },
  { id: 'wa.brief.type.villa', title: 'Villa' },
  { id: 'wa.brief.type.plot', title: 'Plot / land' },
  { id: 'wa.brief.type.estate', title: 'Planted estate' },
];

const BHK_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.bhk.1', title: '1 BHK' },
  { id: 'wa.brief.bhk.2', title: '2 BHK' },
  { id: 'wa.brief.bhk.3', title: '3 BHK' },
  { id: 'wa.brief.bhk.4', title: '4+ BHK' },
  { id: 'wa.brief.bhk.done', title: 'Done' },
];

const WORRY_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.worries.nothing', title: 'Nothing specific' },
  { id: 'wa.brief.worries.overpay', title: 'Overpaying' },
  { id: 'wa.brief.worries.hidden', title: 'Hidden costs' },
  { id: 'wa.brief.worries.traffic', title: 'Daily traffic' },
  { id: 'wa.brief.worries.schools', title: 'Schools too far' },
  { id: 'wa.brief.worries.builder', title: 'Trusting the builder' },
  { id: 'wa.brief.worries.resale', title: 'Resale value' },
];

const SCHOOL_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.schools.yes', title: 'Yes, factor them in' },
  { id: 'wa.brief.schools.no', title: 'Not a priority' },
];

const HUB_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.hub.itpl', title: 'Whitefield / ITPL' },
  { id: 'wa.brief.hub.ecity', title: 'Electronic City' },
  { id: 'wa.brief.hub.manyata', title: 'Manyata / North' },
  { id: 'wa.brief.hub.cbd', title: 'MG Road / CBD' },
  { id: 'wa.brief.hub.none', title: 'Not commute-driven' },
];

const PRIORITY_ROWS: WaBriefRow[] = [
  { id: 'wa.brief.priority.commute', title: 'Shorter commute' },
  { id: 'wa.brief.priority.budget', title: 'Staying on budget' },
  { id: 'wa.brief.priority.equal', title: 'About equal' },
];

const WORRY_TOKEN: Record<string, string> = {
  'wa.brief.worries.nothing': 'nothing specific',
  'wa.brief.worries.overpay': 'overpaying',
  'wa.brief.worries.hidden': 'hidden costs',
  'wa.brief.worries.traffic': 'daily traffic',
  'wa.brief.worries.schools': 'schools too far',
  'wa.brief.worries.builder': 'trusting the builder',
  'wa.brief.worries.resale': 'resale value',
};

const HUB_LABEL: Record<string, string> = {
  'wa.brief.hub.itpl': 'Whitefield / ITPL',
  'wa.brief.hub.ecity': 'Electronic City',
  'wa.brief.hub.manyata': 'Manyata / North',
  'wa.brief.hub.cbd': 'MG Road / CBD',
};

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function needsBhk(c: Constraints): boolean {
  if (c.purpose === 'investment') return false;
  const t = (c.propertyType ?? '').toLowerCase();
  if (!t.trim()) return true;
  if (t.includes('apartment') || t.includes('flat')) return true;
  if (/(plantation|planted|estate|villa|plot|land|bungalow)/i.test(t)) return false;
  return true;
}

function isFamilyBrief(c: Constraints): boolean {
  return c.purpose === 'self_use' || /apartment|flat|villa/i.test(c.propertyType ?? '');
}

function schoolsDerivable(c: Constraints): boolean {
  return (c.worries ?? []).some((w) => /school/i.test(w));
}

function commuteSensitive(c: Constraints): boolean {
  return c.purpose === 'self_use' || (c.worries ?? []).some((w) => /traffic|commute/i.test(w));
}

function askedHas(asked: readonly string[], slot: ProbeKind): boolean {
  return asked.includes(slot);
}

/** Next Advisor brief slot — skip filled / waived / derived. */
export function nextWaBriefStep(
  c: Constraints,
  asked: readonly ProbeKind[] = [],
): WaBriefStep | undefined {
  if (!c.purpose && !askedHas(asked, 'purpose')) return 'purpose';
  if (c.budgetMaxInr === undefined && !askedHas(asked, 'budget')) return 'budget';
  if (!c.propertyType?.trim() && !askedHas(asked, 'propertyType')) return 'propertyType';
  // Stay on BHK until Done (multi-select 2 + 3), even after the first size lands.
  if (needsBhk(c) && !askedHas(asked, 'bhk')) return 'bhk';
  if (!c.location?.trim() && !askedHas(asked, 'location')) return 'location';
  if (!(c.worries?.length) && !askedHas(asked, 'worries')) return 'worries';
  if (isFamilyBrief(c) && !schoolsDerivable(c) && !c.schoolsMentioned && !askedHas(asked, 'schools')) {
    return 'schools';
  }
  if (
    commuteSensitive(c) &&
    !c.commuteDeclined &&
    !c.commuteHub &&
    !askedHas(asked, 'hub')
  ) {
    return 'hub';
  }
  const derived = derivedPriorityFromWorries(c);
  if (
    !c.priorityFocus &&
    !derived &&
    !c.commuteDeclined &&
    c.commuteHub &&
    !askedHas(asked, 'priority')
  ) {
    return 'priority';
  }
  return undefined;
}

export function isWaAdvisorBriefReady(
  c: Constraints,
  asked: readonly ProbeKind[] = [],
): boolean {
  return nextWaBriefStep(c, asked) === undefined;
}

export function waBriefPrompt(step: WaBriefStep): string {
  switch (step) {
    case 'purpose':
      return "Before I show you a single home — what brings you here?";
    case 'budget':
      return "Good — so I don't waste your weekends: what's the ceiling you'd rather stay under?";
    case 'propertyType':
      return 'What kind of home are you picturing?';
    case 'bhk':
      return 'How much space does your family need?';
    case 'location':
      return 'Where would you like your life to be — which side of the city?';
    case 'worries':
      return "Last one, and it's the question most portals never ask — what quietly worries you about this purchase? I rank homes around this.";
    case 'schools':
      return 'One more, only if it matters to you — should I weigh school access? Some of the best-value homes sit a few minutes further out.';
    case 'hub':
      return "And if a daily commute is driving this, tell me where you work — I'll rank by real drive time, not distance.";
    case 'priority':
      return 'One quick thing so I rank these right — does a shorter commute matter more, or staying on budget?';
  }
}

export function waGreetCopy(): string {
  return (
    "Hi — I'm Naya. I won't drown you in filters; let's just talk, so I understand what this home needs to do for your family. Nothing you tell me reaches a builder until you decide to visit one.\n\n" +
    waBriefPrompt('purpose')
  );
}

export function locationBriefRows(areas: readonly string[]): WaBriefRow[] {
  const seen = new Set<string>();
  const rows: WaBriefRow[] = [];
  for (const raw of areas) {
    const name = raw.trim();
    if (!name) continue;
    const idSlug = slug(name) || `n${rows.length}`;
    if (seen.has(idSlug)) continue;
    seen.add(idSlug);
    rows.push({
      id: `wa.brief.loc.${idSlug}`,
      title: clip(name, 24),
      description: name.length > 24 ? clip(name, 72) : undefined,
    });
    if (rows.length >= 8) break;
  }
  rows.push({ id: 'wa.brief.loc.open', title: 'Open to suggestions' });
  return rows.slice(0, 10);
}

export function waBriefRows(step: WaBriefStep, areas: readonly string[] = []): WaBriefRow[] {
  switch (step) {
    case 'purpose':
      return PURPOSE_ROWS;
    case 'budget':
      return BUDGET_ROWS;
    case 'propertyType':
      return TYPE_ROWS;
    case 'bhk':
      return BHK_ROWS;
    case 'location':
      return locationBriefRows(areas);
    case 'worries':
      return WORRY_ROWS;
    case 'schools':
      return SCHOOL_ROWS;
    case 'hub':
      return HUB_ROWS;
    case 'priority':
      return PRIORITY_ROWS;
  }
}

export function parseWaBriefId(actionId: string | undefined): string | undefined {
  const aid = actionId?.trim() ?? '';
  if (!aid.startsWith(WA_BRIEF_PREFIX) && !aid.startsWith('wa.brief.loc.')) return undefined;
  return aid;
}

function mergeBhk(prior: string | undefined, next: string): string {
  if (!prior?.trim()) return next;
  const parts = prior.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === next.toLowerCase())) return prior;
  return `${prior}, ${next}`;
}

export function patchFromWaBriefAction(
  actionId: string | undefined,
  state: ConversationState,
  areas: readonly string[] = [],
): WaBriefPatch | undefined {
  const aid = parseWaBriefId(actionId);
  if (!aid) return undefined;

  if (aid === 'wa.brief.purpose.self_use') {
    return { constraints: { purpose: 'self_use' }, markAsked: ['purpose'] };
  }
  if (aid === 'wa.brief.purpose.investment') {
    return { constraints: { purpose: 'investment' }, markAsked: ['purpose'] };
  }
  if (aid === 'wa.brief.purpose.unsure') {
    return { markAsked: ['purpose'] };
  }

  const budgetRow = BUDGET_ROWS.find((r) => r.id === aid);
  if (budgetRow) {
    const parsed = parseBudgetToInr(budgetRow.title);
    if (!parsed) return { markAsked: ['budget'] };
    return {
      constraints: {
        budgetMaxInr: parsed.max,
        ...(parsed.min !== undefined ? { budgetMinInr: parsed.min } : {}),
      },
      markAsked: ['budget'],
    };
  }

  if (aid === 'wa.brief.type.apartment') {
    return { constraints: { propertyType: 'Apartment' }, markAsked: ['propertyType'] };
  }
  if (aid === 'wa.brief.type.villa') {
    return { constraints: { propertyType: 'Villa' }, markAsked: ['propertyType'] };
  }
  if (aid === 'wa.brief.type.plot') {
    return { constraints: { propertyType: 'Plot / land' }, markAsked: ['propertyType'] };
  }
  if (aid === 'wa.brief.type.estate') {
    return { constraints: { propertyType: 'Planted estate' }, markAsked: ['propertyType'] };
  }

  if (aid === 'wa.brief.bhk.done') {
    return { markAsked: ['bhk'] };
  }
  const bhk = BHK_ROWS.find((r) => r.id === aid && r.id !== 'wa.brief.bhk.done');
  if (bhk) {
    const label = bhk.title === '4+ BHK' ? '4 BHK' : bhk.title;
    return {
      constraints: { bhk: mergeBhk(state.constraints.bhk, label) },
      stayOnBhk: true,
    };
  }

  if (aid === 'wa.brief.loc.open') {
    return { markAsked: ['location'] };
  }
  if (aid.startsWith('wa.brief.loc.')) {
    const want = aid.slice('wa.brief.loc.'.length);
    const hit =
      areas.find((a) => slug(a) === want) ??
      locationBriefRows(areas).find((r) => r.id === aid)?.title;
    if (hit) return { constraints: { location: hit }, markAsked: ['location'] };
    return { markAsked: ['location'] };
  }

  const worry = WORRY_TOKEN[aid];
  if (worry) {
    return { constraints: { worries: [worry] }, markAsked: ['worries'], preserveLocation: true };
  }

  if (aid === 'wa.brief.schools.yes') {
    return { constraints: { schoolsMentioned: true }, markAsked: ['schools'], preserveLocation: true };
  }
  if (aid === 'wa.brief.schools.no') {
    return { markAsked: ['schools'], preserveLocation: true };
  }

  if (aid === 'wa.brief.hub.none') {
    return { constraints: { commuteDeclined: true }, markAsked: ['hub'], preserveLocation: true };
  }
  const hub = HUB_LABEL[aid];
  if (hub) {
    return { constraints: { commuteHub: hub }, markAsked: ['hub'], preserveLocation: true };
  }

  if (aid === 'wa.brief.priority.commute') {
    return { constraints: { priorityFocus: 'commute' }, markAsked: ['priority'], preserveLocation: true };
  }
  if (aid === 'wa.brief.priority.budget') {
    return { constraints: { priorityFocus: 'budget' }, markAsked: ['priority'], preserveLocation: true };
  }
  if (aid === 'wa.brief.priority.equal') {
    return { constraints: { priorityFocus: 'balanced' }, markAsked: ['priority'], preserveLocation: true };
  }

  return undefined;
}

export function applyWaBriefPatch(
  state: ConversationState,
  patch: WaBriefPatch,
): ConversationState {
  const priorLoc = state.constraints.location;
  let constraints: Constraints = { ...state.constraints, ...patch.constraints };
  if (patch.preserveLocation) {
    if (priorLoc) constraints = { ...constraints, location: priorLoc };
    else {
      const { location: _drop, ...rest } = constraints;
      constraints = rest;
    }
  }
  let next: ConversationState = { ...state, constraints };
  for (const slot of patch.markAsked ?? []) {
    const asked = next.discover.asked.includes(slot)
      ? next.discover.asked
      : [...next.discover.asked, slot];
    next = { ...next, discover: { ...next.discover, asked } };
  }
  return next;
}
