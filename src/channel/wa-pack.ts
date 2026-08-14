/**
 * WhatsApp project-first packer — builder-allotted book, not Advisor brief.
 * See docs/lld/WA_PROJECT_FIRST_LLD.md
 */
import type { ConversationState, TurnGoal } from '../engine/types.js';
import { HANDOFF_QUESTIONS } from '../engine/book-questions.js';
import type { Extracted } from '../engine/types.js';
import { currentShortlist, focusedRef } from '../engine/entity-store.js';
import type { SuggestedAction } from '../engine/recovery-planner.js';

export const WA_MENU_PROJECTS = 'wa.menu.projects';
/** Second door on the greet: start the two-tap minimal brief (size → budget). */
export const WA_MENU_CHOOSE = 'wa.menu.choose';
/** Jump straight to the budget step (clarify buttons). */
export const WA_MENU_BUDGET = 'wa.menu.budget';
/** Welcome doors (mock parity): open the book / type the project name. */
export const WA_MENU_SEE = 'wa.menu.see';
export const WA_MENU_KNOW = 'wa.menu.know';
export const WA_PICK_PREFIX = 'wa.pick.';
export const WA_BHK_PREFIX = 'wa.bhk.';
export const WA_SIZE_ANY = 'wa.bhk.any';
export const WA_TYPE_VILLA = 'wa.type.villa';
export const WA_TYPE_PLOT = 'wa.type.plot';
/** Budget band ids carry INR in the id — u_{max} / b_{min}_{max} / a_{min} / any. */
export const WA_BUDGET_PREFIX = 'wa.budget.';
export const WA_BUDGET_ANY = 'wa.budget.any';
export const WA_DAY_PREFIX = 'wa.day.';
/** Window / confirm / itinerary answers — one id per answerable question. */
export const WA_WINDOW_PREFIX = 'wa.window.';
export const WA_WINDOW_MORNING = 'wa.window.morning';
export const WA_WINDOW_AFTERNOON = 'wa.window.afternoon';
export const WA_VISIT_CONFIRM = 'wa.visit.confirm';
export const WA_VISIT_CHANGE = 'wa.visit.change';
export const WA_TRIP_ALL = 'wa.trip.all';
/** Money door — one id per money question the book can actually answer. */
export const WA_MONEY_MENU = 'wa.money.menu';
export const WA_MONEY_TOTAL = 'wa.money.total';
export const WA_MONEY_EMI = 'wa.money.emi';
export const WA_MONEY_BHK_PREFIX = 'wa.money.bhk.';
/** Separates a money row's id from the project it was cut for. */
export const WA_PROJECT_STAMP = '@';
/** Config rows we can show before the jobs + way back hit the 10-row ceiling. */
export const WA_MAX_CONFIG_ROWS = 7;
/**
 * Node door — the project card's tap menu (Trust / Place / Life / Time /
 * Later). One id per node the book can actually answer; a node whose data the
 * project does not hold is never drawn, so there is no id for "no data".
 */
export const WA_NODE_PREFIX = 'wa.node.';
export const WA_NODE_TRUST = 'wa.node.trust';
export const WA_NODE_PLACE = 'wa.node.place';
export const WA_NODE_LIFE = 'wa.node.life';
export const WA_NODE_TIME = 'wa.node.time';
export const WA_NODE_LATER = 'wa.node.later';
/** Opens the node menu itself — "More about this project". */
export const WA_MENU_NODE = 'wa.menu.node';

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A tap's MEANING is its id, never its label — the label is for the human.
 * The visit FSM reads free text, so a tap on "Sat 16 Aug" must reach it as
 * the canonical utterance "saturday". Without this the buyer taps a day and
 * the machine re-asks the same question forever (sim V01 deadlock).
 */
export function waCanonicalUtterance(actionId: string | undefined): string | undefined {
  const raw = actionId?.trim() ?? '';
  if (!raw) return undefined;
  // Node rows ride on old messages, so they arrive stamped — strip the stamp
  // before matching; the extract layer re-reads it for the project bind.
  const { aid } = splitProjectStamp(raw);
  // Node taps speak a canonical question cut to hit the engine's closed sets
  // (answer-contract requirement keys, FAQ keys) deterministically. The words
  // name only what the row's honest gate proved the project holds — "legal and
  // approval status" never says "khata", so a rera-only project answers with
  // what it has instead of volunteering a gap nobody asked about.
  if (aid === WA_NODE_TRUST) return 'legal and approval status';
  if (aid === WA_NODE_PLACE) return 'location and connectivity';
  if (aid === WA_NODE_LIFE) return 'what amenities does it have';
  if (aid === WA_NODE_TIME) return 'when is possession';
  if (aid === WA_NODE_LATER) return 'what rental yield and returns can I expect';
  if (aid === WA_MENU_NODE) return 'tell me more about this project';
  if (aid.startsWith(WA_DAY_PREFIX)) {
    const day = aid.slice(WA_DAY_PREFIX.length).toLowerCase();
    return (WEEKDAY_NAMES as readonly string[]).includes(day) ? day : undefined;
  }
  if (aid === WA_WINDOW_MORNING) return 'morning';
  if (aid === WA_WINDOW_AFTERNOON) return 'afternoon';
  if (aid === WA_VISIT_CONFIRM) return 'yes';
  if (aid === WA_VISIT_CHANGE) return 'a different day';
  if (aid === WA_TRIP_ALL) return 'all of them';
  return undefined;
}

/**
 * Every screen needs a door out. A buyer three taps into a visit who changes
 * their mind has no keyboard reflex on WhatsApp — they look for a row.
 */
/**
 * The way back. It reads "← Back to projects", not "← All projects", because
 * the buyer's own size stays on — tapping it returns the book cut to what they
 * already told us, and a row that says ALL must not hand back three of nine.
 */
function withWayBack(rows: WaListRow[]): WaListRow[] {
  if (rows.some((r) => r.id === WA_MENU_PROJECTS)) return rows;
  return [...rows.slice(0, 9), { id: WA_MENU_PROJECTS, title: '← Back to projects' }];
}

/**
 * Day rows cut from the builder's OWN hours — the same string the copy quotes.
 * Hardcoded Saturday/Sunday buttons under "site visits usually Mon–Sun" told
 * every buyer the weekdays were closed.
 */
export function waVisitDayRows(hoursLabel: string | undefined, nowMs: number, openDays: ReadonlySet<number>): WaListRow[] {
  const rows: WaListRow[] = [];
  for (let i = 1; i <= 9 && rows.length < 7; i++) {
    const d = new Date(nowMs + i * 24 * 60 * 60 * 1000);
    const dow = d.getUTCDay();
    if (!openDays.has(dow)) continue;
    const title = `${WEEKDAY_SHORT[dow]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
    const desc =
      i === 1 ? 'tomorrow' : dow === 0 || dow === 6 ? 'weekend' : undefined;
    rows.push({
      id: `${WA_DAY_PREFIX}${WEEKDAY_NAMES[dow]}`,
      title: clip(title, 24),
      ...(desc ? { description: desc } : {}),
    });
  }
  return rows;
}

const BHK_ROWS: Array<{ id: string; title: string; bhk: string }> = [
  { id: 'wa.bhk.1_bhk', title: '1 BHK', bhk: '1 BHK' },
  { id: 'wa.bhk.2_bhk', title: '2 BHK', bhk: '2 BHK' },
  { id: 'wa.bhk.3_bhk', title: '3 BHK', bhk: '3 BHK' },
  { id: 'wa.bhk.4_plus', title: '4+ BHK', bhk: '4 BHK' },
];

export function resolveWaProjectFirst(raw: string | undefined, prodLike: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false') return false;
  if (v === 'on' || v === '1' || v === 'true') return true;
  // Unset: on for non-prod (dig/dev), off for prod.
  return !prodLike;
}

export function parseWaBhk(actionId: string): string | undefined {
  return BHK_ROWS.find((r) => r.id === actionId)?.bhk;
}

export function parseWaPickId(actionId: string): string | undefined {
  if (!actionId.startsWith(WA_PICK_PREFIX)) return undefined;
  const id = actionId.slice(WA_PICK_PREFIX.length).trim();
  return id || undefined;
}

/**
 * List-row tap ≡ Advisor board open: focus the project, do not fetch/compose
 * the overview card. Facet follows (price, legal) still ride followUp.
 */
export function waListPickKeepsCommit(
  actionId: string | undefined,
  goal: { kind: string; followUp?: string; followUpTopics?: readonly string[] },
  extracted: { askTopic?: string; askTopics?: readonly string[] },
): boolean {
  if (!parseWaPickId(actionId ?? '')) return false;
  if (goal.kind !== 'commit') return false;
  if (goal.followUp && goal.followUp !== 'overview') return false;
  if (goal.followUpTopics?.some((t) => t !== 'overview')) return false;
  const facets = [
    ...(extracted.askTopic && extracted.askTopic !== 'overview' ? [extracted.askTopic] : []),
    ...(extracted.askTopics ?? []).filter((t) => t !== 'overview'),
  ];
  return facets.length === 0;
}

export type WaListRow = { id: string; title: string; description?: string };

export type WaPacked =
  | { kind: 'text' }
  | { kind: 'buttons'; buttons: Array<{ id: string; title: string }> }
  | { kind: 'list'; button: string; sections: Array<{ title: string; rows: WaListRow[] }> };

export interface WaPackInput {
  goal: TurnGoal;
  state: ConversationState;
  catalogNames: ReadonlyArray<{ projectId: string; name: string; description?: string }>;
  singleProject: boolean;
  briefAreas?: readonly string[];
  /** Book-wide spread + types — size/budget sheets derive their rows from this. */
  catalog?: { priceMinInr?: number; priceMaxInr?: number; projectTypes?: readonly string[] } | null;
  /** Builder site hours — day rows must be cut from the same string the copy quotes. */
  siteVisitHours?: string;
  openDays?: ReadonlySet<number>;
  nowMs?: number;
  /** Configs of the focused project — the money menu is cut from these, never invented. */
  focusUnits?: ReadonlyArray<{ unitType: string; priceDisplay: string; sizeDisplay?: string }>;
  /**
   * The focused project's own record (evidence.detail) — the node menu is cut
   * from what THIS project actually holds. Absent (detail not fetched this
   * turn) the menu simply isn't offered; a "More" that opens onto nothing is
   * the dishonest affordance this whole layer exists to avoid.
   */
  focusFacts?: WaNodeFacts;
  /**
   * The buyer tapped a door that opens the book (See everything / Back to
   * projects) — greet-shaped goals then show the project list, not the
   * three-button welcome.
   */
  bookOpen?: boolean;
}

/**
 * What the node menu reads off ProjectDetail — every field optional, and a row
 * is drawn ONLY when its data exists. The gap doesn't disappear; it moves to
 * the content backlog instead of the buyer's screen.
 */
export interface WaNodeFacts {
  projectId?: string;
  reraNumber?: string;
  khata?: string;
  ecStatus?: string;
  possession?: string;
  phases?: ReadonlyArray<{ possession?: string; reraNumber?: string }>;
  amenities?: readonly string[];
  location?: {
    connectivitySummary?: string;
    microMarketOverview?: string;
    nearbyPois?: readonly string[];
    driveTimes?: readonly string[];
    schools?: readonly unknown[];
    hospitals?: readonly unknown[];
    metroStations?: readonly unknown[];
  };
  investment?: {
    expectedRoi?: string;
    revenueModel?: string;
    operatorBrand?: string;
    guaranteedPayment?: string;
  };
  marketIntel?: {
    appreciation3yrPct?: number;
    appreciation5yrPct?: number;
    corridorMaturity?: string;
    rentBands?: ReadonlyArray<unknown>;
    drivers?: ReadonlyArray<unknown>;
  };
  mediaKinds?: readonly string[];
  /** The focused project's configs — money-row gates read these. */
  configurations?: ReadonlyArray<{
    unitType: string;
    priceDisplay?: string;
    sizeDisplay?: string;
  }>;
}

function locationHasData(loc: WaNodeFacts['location']): boolean {
  if (!loc) return false;
  return Object.values(loc).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : Boolean(v),
  );
}

/**
 * Returns row gate — typed against the REAL ProjectMarketIntel/ProjectInvestment
 * fields. A bare `{}` or a displayName-only intel object must NOT draw the row:
 * the screen reads these same fields, and a drawn row that opens onto nothing
 * is the dishonest affordance this layer bans.
 */
export function hasReturnsData(
  intel?: {
    appreciation3yrPct?: number;
    appreciation5yrPct?: number;
    corridorMaturity?: string;
    rentBands?: ReadonlyArray<unknown>;
    drivers?: ReadonlyArray<unknown>;
  },
  inv?: {
    expectedRoi?: string;
    revenueModel?: string;
    operatorBrand?: string;
    guaranteedPayment?: string;
  },
): boolean {
  if (intel) {
    if (intel.appreciation3yrPct !== undefined || intel.appreciation5yrPct !== undefined) return true;
    if (intel.corridorMaturity?.trim()) return true;
    if (intel.rentBands?.length) return true;
    if (intel.drivers?.length) return true;
  }
  if (inv) {
    if (inv.expectedRoi?.trim() || inv.revenueModel?.trim()) return true;
    if (inv.operatorBrand?.trim() || inv.guaranteedPayment?.trim()) return true;
  }
  return false;
}

/**
 * The node menu — the card's "what do you want to check?", cut from the
 * project's own record. Brochure leads: it is the cheapest yes in the funnel
 * and the thing buyers ask for long before they accept a visit.
 */
export function waNodeRows(facts: WaNodeFacts | undefined): WaListRow[] {
  if (!facts) return [];
  const rows: WaListRow[] = [];
  if (facts.mediaKinds?.includes('brochure')) {
    rows.push({ id: 'answer_media', title: 'Brochure', description: 'the full project PDF' });
  }
  const trust = [
    facts.reraNumber?.trim() || facts.phases?.some((p) => p.reraNumber?.trim()) ? 'RERA' : '',
    facts.khata?.trim() ? 'khata & title' : '',
    facts.ecStatus?.trim() ? 'EC' : '',
  ].filter(Boolean);
  if (trust.length) {
    rows.push({ id: WA_NODE_TRUST, title: 'Trust & legal', description: clip(trust.join(' · '), 72) });
  }
  if (locationHasData(facts.location)) {
    const bits = [
      facts.location?.schools?.length ? 'schools' : '',
      facts.location?.hospitals?.length ? 'hospitals' : '',
      'commute',
    ].filter(Boolean);
    rows.push({ id: WA_NODE_PLACE, title: 'Location', description: clip(bits.join(' · '), 72) });
  }
  if (facts.amenities?.length) {
    rows.push({
      id: WA_NODE_LIFE,
      title: 'Amenities',
      description: clip(facts.amenities.slice(0, 3).join(', '), 72),
    });
  }
  if (facts.possession?.trim() || facts.phases?.some((p) => p.possession?.trim())) {
    rows.push({ id: WA_NODE_TIME, title: 'Possession', description: 'dates and status' });
  }
  // Returns rides only when the yield IS on the record — an investment product
  // speaks it; a family apartment never volunteers it.
  if (hasReturnsData(facts.marketIntel, facts.investment)) {
    rows.push({ id: WA_NODE_LATER, title: 'Returns', description: 'yield, appreciation, exit' });
  }
  rows.push({ id: 'visit_book', title: 'Book a visit', description: 'pick a day and a time' });
  return rows;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/** ₹ label for band rows — lakh under 1 Cr, crore above (matches compose.formatInr voice). */
function inrLabel(v: number): string {
  if (v >= 1_00_00_000) {
    const cr = v / 1_00_00_000;
    const s = cr % 1 === 0 ? String(cr) : cr.toFixed(1).replace(/\.0$/, '');
    return `₹${s} Cr`;
  }
  return `₹${Math.round(v / 1_00_000)}L`;
}

/** Round to a tappable price edge: nearest ₹5L under 1 Cr, nearest ₹25L above. */
function niceInr(v: number): number {
  const step = v >= 1_00_00_000 ? 25_00_000 : 5_00_000;
  return Math.max(step, Math.round(v / step) * step);
}

/**
 * Budget rows — bands cut from the live book spread (thirds on nice edges);
 * fixed ladder only when the catalog gave no spread. Ids carry the numbers so
 * extraction never parses a label.
 */
export function waBudgetRows(
  catalog: WaPackInput['catalog'],
  bagSize: number,
): WaListRow[] {
  const min = catalog?.priceMinInr ?? 0;
  const max = catalog?.priceMaxInr ?? 0;
  let edges: [number, number];
  if (min > 0 && max > min * 1.2) {
    const t1 = niceInr(min + (max - min) / 3);
    const t2 = niceInr(min + (2 * (max - min)) / 3);
    edges = t2 > t1 ? [t1, t2] : [t1, niceInr(t1 * 1.5)];
  } else {
    edges = [50_00_000, 1_00_00_000];
  }
  const [lo, hi] = edges;
  return [
    { id: `${WA_BUDGET_PREFIX}u_${lo}`, title: clip(`Under ${inrLabel(lo)}`, 24) },
    { id: `${WA_BUDGET_PREFIX}b_${lo}_${hi}`, title: clip(`${inrLabel(lo)} – ${inrLabel(hi)}`, 24) },
    { id: `${WA_BUDGET_PREFIX}a_${hi}`, title: clip(`Above ${inrLabel(hi)}`, 24) },
    {
      id: WA_BUDGET_ANY,
      title: 'Any budget',
      ...(bagSize > 0 ? { description: `show all ${bagSize}` } : {}),
    },
  ];
}

/** Size rows — BHKs plus plot/villa only when the book actually has them. */
export function waSizeRows(
  catalog: WaPackInput['catalog'],
  bagSize: number,
): WaListRow[] {
  const types = (catalog?.projectTypes ?? []).join(' ').toLowerCase();
  const rows: WaListRow[] = BHK_ROWS.map((r) => ({ id: r.id, title: r.title }));
  if (/villa|bungalow/.test(types)) rows.push({ id: WA_TYPE_VILLA, title: 'Villa' });
  if (/plot|land/.test(types)) rows.push({ id: WA_TYPE_PLOT, title: 'Plot / land' });
  rows.push({
    id: WA_SIZE_ANY,
    title: 'Any size',
    ...(bagSize > 0 ? { description: `show all ${bagSize}` } : {}),
  });
  return rows.slice(0, 10);
}

function projectRows(
  names: ReadonlyArray<{ projectId: string; name: string; description?: string }>,
  shortlistIds: ReadonlySet<string>,
): WaListRow[] {
  return names.slice(0, 9).map((p, i) => ({
    id: `${WA_PICK_PREFIX}${p.projectId}`,
    title: clip(`${i + 1}. ${p.name}`, 24),
    description: clip(p.description || (shortlistIds.has(p.projectId) ? 'on your board' : ''), 72) || undefined,
  }));
}

function jobButtons(
  singleProject: boolean,
  nodeMenuId?: string,
): Array<{ id: string; title: string }> {
  // When the focused project's record backs a node menu, the third slot opens
  // it — Projects and Brochure move inside (way back / brochure rows). When
  // the record isn't in hand this turn, the slot stays what it was: a More
  // that opens onto nothing is the dishonest affordance this layer bans.
  const escape = nodeMenuId
    ? { id: nodeMenuId, title: 'More' }
    : singleProject
      ? { id: 'answer_media', title: 'Brochure' }
      : { id: WA_MENU_PROJECTS, title: 'Projects' };
  return [
    // "Price / EMI" promised two things and delivered one. A label names ONE
    // job, and this one opens the money menu — where EMI is a row of its own.
    { id: WA_MONEY_MENU, title: 'Price' },
    { id: 'visit_book', title: 'Book a visit' },
    escape,
  ];
}

/**
 * The money menu, cut from the project's own configs. A buyer who taps Price
 * wants one of a small, knowable set of things — and which of them we can
 * actually answer depends on what the book holds for THIS project, so the rows
 * are derived, never a fixed list pasted onto every project.
 */
function moneyRows(units: WaPackInput['focusUnits']): WaListRow[] {
  const rows: WaListRow[] = [{ id: WA_MONEY_TOTAL, title: 'Total price', description: 'the headline number' }];
  // Two configs can share a BHK count ("2 BHK" and "2 BHK Comfort"), so the
  // count alone is not an identity. WhatsApp rejects a list whose row ids
  // collide — and rejects it silently, taking the answer down with it.
  const taken = new Set<string>(rows.map((r) => r.id));
  // 7 configs is the most that still leaves room for the jobs and the way back
  // inside Meta's 10-row ceiling — and the pick list promises this same count.
  for (const u of (units ?? []).slice(0, WA_MAX_CONFIG_ROWS)) {
    const bhk = /(\d+)\s*BHK/i.exec(u.unitType)?.[1];
    if (!bhk) continue;
    let id = `${WA_MONEY_BHK_PREFIX}${bhk}`;
    if (taken.has(id)) {
      const variant = u.unitType.replace(/^\s*\d+\s*BHK\s*/i, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      id = `${WA_MONEY_BHK_PREFIX}${bhk}.${variant || String(rows.length)}`;
      while (taken.has(id)) id = `${id}.${rows.length}`;
    }
    taken.add(id);
    rows.push({
      id,
      title: clip(u.unitType, 24),
      description: clip([u.sizeDisplay, u.priceDisplay].filter(Boolean).join(' · '), 72) || undefined,
    });
  }
  rows.push({ id: WA_MONEY_EMI, title: 'Monthly EMI', description: 'what it costs per month' });
  return rows;
}

/**
 * A money row means "…of THIS project", so it carries the project on its id.
 * The rows are cut from one project's configs, but the tap arrives out of band
 * — minutes later, from an old message, and against whatever state the read
 * side hands back. A tap that has to be told which project it meant is a tap
 * that can mean the wrong one: unstamped, a "2 BHK" row inside Brigade
 * Eldorado came back as a book-wide search across three other projects.
 */
function stampProject(rows: readonly WaListRow[], projectId?: string): WaListRow[] {
  if (!projectId) return [...rows];
  const stampable = (id: string) =>
    id === WA_MONEY_TOTAL ||
    id === WA_MONEY_EMI ||
    id.startsWith(WA_MONEY_BHK_PREFIX) ||
    // Node rows outlive the state that drew them the same way money rows do —
    // a "Trust & legal" tap from last night's card must answer THAT project.
    // Legacy ids (visit_book, answer_media) stay unstamped: the speech-act
    // catalog resolves them by EXACT id, and their wire shape already shipped.
    id.startsWith(WA_NODE_PREFIX) ||
    id === WA_MENU_NODE;
  return rows.map((r) =>
    stampable(r.id) ? { ...r, id: `${r.id}${WA_PROJECT_STAMP}${projectId}` } : r,
  );
}

/** Reverse of {@link stampProject} — the bare id plus the project it was cut for. */
export function splitProjectStamp(actionId: string): { aid: string; projectId?: string } {
  const at = actionId.lastIndexOf(WA_PROJECT_STAMP);
  if (at <= 0) return { aid: actionId };
  return { aid: actionId.slice(0, at), projectId: actionId.slice(at + 1) || undefined };
}

export function packWhatsAppInteractive(input: WaPackInput): WaPacked {
  const { goal, state, catalogNames, singleProject } = input;
  const focus = focusedRef(state);
  const shortlist = currentShortlist(state);
  const shortlistIds = new Set(shortlist.map((o) => o.projectId));
  const bag = catalogNames.filter((p) => p.projectId && p.name);

  // Minimal-brief steps: size and budget render as list sheets.
  if (goal.kind === 'probe' && (goal.slot === 'bhk' || goal.slot === 'propertyType')) {
    return {
      kind: 'list',
      button: 'Choose size',
      sections: [{ title: 'Size', rows: withWayBack(waSizeRows(input.catalog, bag.length)) }],
    };
  }
  if (goal.kind === 'probe' && goal.slot === 'budget') {
    return {
      kind: 'list',
      button: 'Set budget',
      sections: [{ title: 'Budget', rows: withWayBack(waBudgetRows(input.catalog, bag.length)) }],
    };
  }

  // Honest probe on a miss — three doors, never a re-dump.
  if (goal.kind === 'clarify_intent' && !focus) {
    return {
      kind: 'buttons',
      buttons: [
        { id: WA_MENU_CHOOSE, title: 'Choose size' },
        { id: WA_MENU_BUDGET, title: 'Set budget' },
        { id: WA_MENU_PROJECTS, title: 'Projects' },
      ],
    };
  }

  // The chrome answers the question that was just asked — nothing else.
  // Packing day buttons under "morning or afternoon?" made the pure-tap path
  // an infinite loop: the tap re-answered the day, so the window never came.
  if (goal.kind === 'visit_ask') {
    switch (goal.ask) {
      case 'window':
        return {
          kind: 'buttons',
          buttons: [
            { id: WA_WINDOW_MORNING, title: 'Morning' },
            { id: WA_WINDOW_AFTERNOON, title: 'Afternoon' },
            { id: WA_VISIT_CHANGE, title: 'Change day' },
          ],
        };
      case 'which_projects': {
        const stops = (goal.state?.candidateIds ?? []).slice(0, 8);
        if (stops.length >= 2) {
          return {
            kind: 'list',
            button: 'Pick stops',
            sections: [
              {
                title: 'Which to see',
                rows: withWayBack([
                  ...stops.map((s) => ({ id: `${WA_PICK_PREFIX}${s.projectId}`, title: clip(s.projectName, 24) })),
                  { id: WA_TRIP_ALL, title: 'All of them', description: 'one trip, same day' },
                ]),
              },
            ],
          };
        }
        break;
      }
      case 'same_day_choice':
      case 'split_day':
        return {
          kind: 'buttons',
          buttons: [
            { id: WA_TRIP_ALL, title: 'Same day' },
            { id: WA_VISIT_CHANGE, title: 'Different days' },
            { id: WA_MENU_PROJECTS, title: 'Projects' },
          ],
        };
      case 'origin':
      case 'team_request':
        // Open answers — a free-text reply is the only honest option.
        return { kind: 'buttons', buttons: [{ id: WA_MENU_PROJECTS, title: 'Projects' }] };
      default:
        break;
    }
    const days = waVisitDayRows(input.siteVisitHours, input.nowMs ?? 0, input.openDays ?? new Set([0, 1, 2, 3, 4, 5, 6]));
    if (days.length) {
      return { kind: 'list', button: 'Pick a day', sections: [{ title: 'Choose a day', rows: withWayBack(days) }] };
    }
  }

  if (goal.kind === 'visit_propose') {
    return {
      kind: 'buttons',
      buttons: [
        { id: WA_VISIT_CONFIRM, title: 'Confirm ✓' },
        { id: WA_VISIT_CHANGE, title: 'Change day' },
        { id: WA_MENU_PROJECTS, title: 'Projects' },
      ],
    };
  }

  if (goal.kind === 'propose_visit') {
    const days = waVisitDayRows(input.siteVisitHours, input.nowMs ?? 0, input.openDays ?? new Set([0, 1, 2, 3, 4, 5, 6]));
    if (days.length) {
      return { kind: 'list', button: 'Pick a day', sections: [{ title: 'Choose a day', rows: withWayBack(days) }] };
    }
  }

  if (goal.kind === 'visit_booked') {
    return {
      kind: 'buttons',
      buttons: [
        { id: 'visit_book', title: 'Add a visit' },
        { id: WA_MENU_PROJECTS, title: 'Projects' },
      ],
    };
  }

  // "I'll have someone call you" rides the recommend goal so it can reach the
  // book-question composer, but it is an ANSWER, not a listing: putting nine
  // project rows under a callback promise reads as the brush-off the buyer was
  // trying to escape, and the copy's next tap ("Book a visit") isn't on screen.
  const handoffAnswer =
    goal.kind === 'recommend' && !!goal.bookQuestion && HANDOFF_QUESTIONS.has(goal.bookQuestion);
  const showMatches =
    !focus &&
    !handoffAnswer &&
    (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') &&
    bag.length > 0;
  const showBag =
    !focus &&
    (goal.kind === 'greet' ||
      goal.kind === 'orient' ||
      goal.kind === 'smalltalk' ||
      goal.kind === 'advance' ||
      goal.kind === 'clarify_project_pick');

  // The mock's welcome: three quiet doors, not nine rows. The book list is one
  // tap away behind "See everything"; a reset/greet without that tap never
  // dumps the whole catalog on the first screen.
  if (showBag && goal.kind === 'greet' && !input.bookOpen && bag.length > 1) {
    return {
      kind: 'buttons',
      buttons: [
        { id: WA_MENU_CHOOSE, title: 'Help me choose' },
        { id: WA_MENU_SEE, title: 'See everything' },
        { id: WA_MENU_KNOW, title: 'I know the project' },
      ],
    };
  }

  if ((showMatches || showBag) && bag.length > 0) {
    const rows: WaListRow[] = [];
    // Second door: buyers who don't know the book tap into the two-tap brief.
    if (
      showBag &&
      bag.length > 1 &&
      (goal.kind === 'greet' || goal.kind === 'smalltalk' || goal.kind === 'orient')
    ) {
      rows.push({
        id: WA_MENU_CHOOSE,
        title: '✨ Help me choose',
        description: '2 taps — size, then budget',
      });
    }
    if (shortlist.length && showBag && goal.kind !== 'greet') {
      rows.push({
        id: WA_MENU_PROJECTS,
        title: clip('Your board', 24),
        description: clip(shortlist.map((o) => o.name).join(', '), 72),
      });
    }
    rows.push(...projectRows(bag, shortlistIds));
    return {
      kind: 'list',
      button: showMatches ? 'See matches' : 'See projects',
      sections: [{ title: showMatches ? 'Matches' : 'Projects', rows: rows.slice(0, 10) }],
    };
  }

  // Money answer → the money menu, so the next question is one tap and the
  // rows say which of them this project can actually answer.
  if (goal.kind === 'answer' && (goal.topic === 'price' || goal.topic === 'emi') && focus) {
    // Never re-offer the row we just answered — that is what made the visit
    // chrome loop forever, and it reads as "the bot didn't hear me".
    const justAnswered = goal.topic === 'emi' ? WA_MONEY_EMI : WA_MONEY_TOTAL;
    // The buyer already named a size (brief tap or typed): the size question is
    // ANSWERED. Re-offering the ladder reads as "the bot didn't hear me" — the
    // rows move on to what they haven't learned yet: EMI, then the nodes.
    if (state.constraints?.bhk?.trim()) {
      const next: WaListRow[] = [
        ...(justAnswered !== WA_MONEY_EMI
          ? [{ id: WA_MONEY_EMI, title: 'Monthly EMI', description: 'what it costs per month' }]
          : [{ id: WA_MONEY_TOTAL, title: 'Total price', description: 'the headline number' }]),
        ...waNodeRows(input.focusFacts),
      ];
      if (!next.some((r) => r.id === 'visit_book')) {
        next.push({ id: 'visit_book', title: 'Book a visit', description: 'pick a day and a time' });
      }
      return {
        kind: 'list',
        button: 'What next',
        sections: [
          {
            title: clip(focus.projectName ?? 'This project', 24),
            rows: withWayBack(stampProject(next, focus.projectId)),
          },
        ],
      };
    }
    const rows = stampProject(
      moneyRows(input.focusUnits).filter((r) => r.id !== justAnswered),
      focus.projectId,
    );
    if (rows.length > 1) {
      return {
        kind: 'list',
        button: 'Money',
        // 24 is the whole section title, not the name inside it — "Costs — "
        // costs 8 of it, so a long name has to be clipped against the total.
        sections: [{ title: clip(`Costs — ${focus.projectName ?? 'this project'}`, 24), rows: withWayBack(rows) }],
      };
    }
  }

  // Overview on a focused project → the node menu: "what do you want to
  // check?", cut from what THIS project's record actually holds. This is the
  // card's tap menu — Money rides the buttons everywhere, so the list carries
  // the nodes money doesn't cover.
  if (goal.kind === 'answer' && goal.topic === 'overview' && focus) {
    const nodeRows = waNodeRows(input.focusFacts);
    // More than the visit row alone — a menu of one job is not a menu.
    if (nodeRows.length > 1) {
      return {
        kind: 'list',
        button: 'What to check',
        sections: [
          {
            title: clip(focus.projectName ?? 'This project', 24),
            rows: withWayBack(stampProject(nodeRows, focus.projectId)),
          },
        ],
      };
    }
  }

  // Project pick with the size ALREADY known (brief tap or typed): the card
  // never re-asks it. Rows go to the money answers for that size and the nodes
  // the record can back — the mock's "next steps", not a second size ladder.
  if (goal.kind === 'commit' && focus && state.constraints?.bhk?.trim()) {
    const rows: WaListRow[] = [
      {
        id: WA_MONEY_TOTAL,
        title: clip(`Price — ${state.constraints.bhk}`, 24),
        description: 'the headline number',
      },
      { id: WA_MONEY_EMI, title: 'Monthly EMI', description: 'what it costs per month' },
      ...waNodeRows(input.focusFacts),
    ];
    if (!rows.some((r) => r.id === 'visit_book')) {
      rows.push({ id: 'visit_book', title: 'Book a visit', description: 'pick a day and a time' });
    }
    if (rows.length > 3) {
      return {
        kind: 'list',
        button: 'What next',
        sections: [
          {
            title: clip(focus.projectName ?? 'This project', 24),
            rows: withWayBack(stampProject(rows, focus.projectId)),
          },
        ],
      };
    }
  }

  // Project pick → that project's OWN sizes. The book design's step 2 ("Tap
  // Cornerstone → list BHK"), with one change: the two jobs ride the same list,
  // so choosing a size is an option and never a toll gate on the way to price.
  if (goal.kind === 'commit' && focus && !state.constraints?.bhk?.trim()) {
    const configs = moneyRows(input.focusUnits).filter(
      (r) => r.id !== WA_MONEY_TOTAL && r.id !== WA_MONEY_EMI,
    );
    if (configs.length >= 2) {
      // The More row costs one config slot (6 + price + more + visit + way
      // back = Meta's 10). The 7th config stays reachable via the money menu.
      const rows: WaListRow[] = [
        ...stampProject(configs.slice(0, WA_MAX_CONFIG_ROWS - 1), focus.projectId),
        ...stampProject(
          [
            { id: WA_MONEY_TOTAL, title: 'Price for all sizes', description: 'the headline number' },
            {
              id: WA_MENU_NODE,
              title: 'More about this project',
              description: 'legal, location, possession…',
            },
          ],
          focus.projectId,
        ),
        { id: 'visit_book', title: 'Book a visit', description: 'pick a day and a time' },
      ];
      return {
        kind: 'list',
        button: 'Pick a size',
        sections: [{ title: clip(focus.projectName ?? 'This project', 24), rows: withWayBack(rows) }],
      };
    }
  }

  if (focus || handoffAnswer || goal.kind === 'answer' || goal.kind === 'commit' || goal.kind === 'shortlist_answer') {
    // ≥2 rows beyond the visit row — a menu the record can actually fill.
    const nodeMenuBacked = focus && waNodeRows(input.focusFacts).length > 2;
    return {
      kind: 'buttons',
      buttons: jobButtons(
        singleProject || bag.length <= 1,
        nodeMenuBacked ? `${WA_MENU_NODE}${WA_PROJECT_STAMP}${focus.projectId}` : undefined,
      ),
    };
  }

  if (bag.length > 0) {
    return {
      kind: 'list',
      button: 'See projects',
      sections: [{ title: 'Projects', rows: projectRows(bag, shortlistIds).slice(0, 10) }],
    };
  }

  return { kind: 'text' };
}

/** Graph-shaped interactive payload for /chat and Saarathi send. */
export type WaInteractiveDto =
  | { type: 'button'; buttons: Array<{ id: string; title: string }> }
  | { type: 'list'; button: string; sections: Array<{ title: string; rows: WaListRow[] }> };

export function packedToInteractive(packed: WaPacked): WaInteractiveDto | undefined {
  if (packed.kind === 'buttons' && packed.buttons.length > 0) {
    return { type: 'button', buttons: packed.buttons };
  }
  if (packed.kind === 'list' && packed.sections.some((s) => s.rows.length > 0)) {
    return { type: 'list', button: packed.button, sections: packed.sections };
  }
  return undefined;
}

/** Map packed chrome onto the existing whatsapp_actions slice (buttons only). */
export function packedToSuggestedActions(packed: WaPacked): SuggestedAction[] | undefined {
  if (packed.kind !== 'buttons' || packed.buttons.length === 0) return undefined;
  return packed.buttons.map((b) => ({
    id: b.id,
    label: b.title,
    patch: {},
    user_line: b.title,
    expected_matches: 0,
  }));
}

export function applyWaInteractiveExtract(
  actionId: string | undefined,
  extracted: Extracted,
  catalogNames: ReadonlyArray<{ projectId?: string; name: string }>,
): Extracted {
  const raw = actionId?.trim() ?? '';
  if (!raw) return extracted;
  // A stamped money row names its own project, so the tap survives a stale
  // read and an old message alike: it re-focuses the project it was cut for
  // before it is decoded as a size or a price ask.
  const { aid, projectId: stamp } = splitProjectStamp(raw);
  const stamped = stamp ? catalogNames.find((p) => p.projectId === stamp) : undefined;
  if (stamped?.projectId && stamped.name) {
    extracted = {
      ...extracted,
      pickName: stamped.name,
      namedProjects: [{ projectId: stamped.projectId, name: stamped.name }],
      implicitProjectPick: false,
    };
  }
  if (aid === WA_MENU_PROJECTS) {
    // Topics off the label ("Projects" ≈ overview ask) would rebind the last
    // discussed project — the tap means "back to the book", nothing else.
    return {
      ...extracted,
      speechAct: 'search',
      namedProjects: undefined,
      pickName: undefined,
      implicitProjectPick: false,
      transition: undefined,
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
    };
  }
  // Brief navigation / "any" rows — benign answers; the step machine routes them.
  // The id is authoritative: topics the intent layer read off the LABEL text
  // ("Help me choose" ≈ an ask) are noise and would dodge the brief trap.
  if (aid === WA_MENU_CHOOSE || aid === WA_MENU_BUDGET || aid === WA_SIZE_ANY || aid === WA_BUDGET_ANY) {
    return {
      ...extracted,
      speechAct: 'answer',
      namedProjects: undefined,
      pickName: undefined,
      implicitProjectPick: false,
      transition: undefined,
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
    };
  }
  if (aid === WA_TYPE_VILLA || aid === WA_TYPE_PLOT) {
    return {
      ...extracted,
      speechAct: 'answer',
      transition: undefined,
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
      constraints: {
        ...extracted.constraints,
        propertyType: aid === WA_TYPE_VILLA ? 'Villa' : 'Plot / land',
      },
    };
  }
  if (aid.startsWith(WA_BUDGET_PREFIX)) {
    const body = aid.slice(WA_BUDGET_PREFIX.length);
    const under = /^u_(\d+)$/.exec(body);
    const between = /^b_(\d+)_(\d+)$/.exec(body);
    const above = /^a_(\d+)$/.exec(body);
    const patch = under
      ? { budgetMaxInr: Number(under[1]) }
      : between
        ? { budgetMinInr: Number(between[1]), budgetMaxInr: Number(between[2]) }
        : above
          ? { budgetMinInr: Number(above[1]) }
          : undefined;
    if (!patch) return extracted;
    // Band labels read like price asks ("Under ₹85L") — the tap is an answer.
    return {
      ...extracted,
      speechAct: 'answer',
      transition: undefined,
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
      constraints: { ...extracted.constraints, ...patch },
    };
  }
  const pickId = parseWaPickId(aid);
  if (pickId) {
    const hit = catalogNames.find((p) => p.projectId === pickId);
    const name = hit?.name ?? extracted.pickName;
    return {
      ...extracted,
      speechAct: 'answer',
      transition: 'want_details',
      pickName: name,
      namedProjects: hit?.projectId && hit.name ? [{ projectId: hit.projectId, name: hit.name }] : extracted.namedProjects,
      implicitProjectPick: false,
    };
  }
  const bhk = parseWaBhk(aid);
  if (bhk) {
    return {
      ...extracted,
      speechAct: extracted.speechAct === 'unknown' || !extracted.speechAct ? 'answer' : extracted.speechAct,
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
      constraints: { ...extracted.constraints, bhk },
    };
  }
  // Node taps — the id names the node; the canonical utterance (see
  // waCanonicalUtterance) carries the words the closed sets parse. Both say
  // the same thing, so neither the label nor the embedder gets a vote.
  const nodeTopic: Record<string, import('../engine/types.js').AnswerTopic> = {
    [WA_NODE_TRUST]: 'legal',
    [WA_NODE_PLACE]: 'location',
    [WA_NODE_LIFE]: 'amenities',
    // Time and Later have no AnswerTopic of their own — possession and yield
    // ride overview, where FAQ/FactKey own the fact (embedder-map:18).
    [WA_NODE_TIME]: 'overview',
    [WA_NODE_LATER]: 'overview',
    [WA_MENU_NODE]: 'overview',
  };
  const topic = nodeTopic[aid];
  if (topic) {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: topic,
      askTopics: [topic],
      transition: 'want_details',
      isQuestion: false,
    };
  }
  if (aid === 'visit_book') {
    return { ...extracted, speechAct: 'visit_book', transition: 'want_visit' };
  }
  // Legacy id from the screens that labelled this button "Price / EMI". Old
  // WhatsApp messages stay tappable forever, so the promise those words made is
  // still live — answer both, even though today's button says only "Price".
  if (aid === 'answer_price') {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'price',
      askTopics: ['price', 'emi'],
      transition: 'want_details',
      isQuestion: false,
    };
  }
  if (aid === WA_MONEY_MENU || aid === WA_MONEY_TOTAL) {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'price',
      askTopics: ['price'],
      transition: 'want_details',
      isQuestion: false,
    };
  }
  if (aid === WA_MONEY_EMI) {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'emi',
      askTopics: ['emi'],
      transition: 'want_details',
      isQuestion: false,
    };
  }
  if (aid.startsWith(WA_MONEY_BHK_PREFIX)) {
    // The suffix may carry a variant ("2.comfort") — the size is the leading int.
    const bhk = Number(/^\d+/.exec(aid.slice(WA_MONEY_BHK_PREFIX.length))?.[0]);
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'price',
      askTopics: ['price'],
      transition: 'want_details',
      isQuestion: false,
      // Canonical form is "2 BHK" everywhere else in the engine — a bare "2"
      // reached the ack as "Noted: *2*." and read as a quantity, not a size.
      ...(Number.isFinite(bhk) && bhk > 0
        ? { constraints: { ...extracted.constraints, bhk: `${bhk} BHK` } }
        : {}),
    };
  }
  if (aid === 'answer_media') {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'media',
      askTopics: ['media'],
      mediaAssetKind: 'brochure',
      transition: 'want_details',
    };
  }
  if (aid.startsWith(WA_DAY_PREFIX) || aid.startsWith(WA_WINDOW_PREFIX) || aid === WA_TRIP_ALL) {
    return {
      ...extracted,
      speechAct: 'visit_book',
      transition: 'want_visit',
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
    };
  }
  if (aid === WA_VISIT_CONFIRM || aid === WA_VISIT_CHANGE) {
    // Both continue the SAME booking — confirm accepts the proposed slot,
    // change re-opens the day. Neither is a new search or a facet ask.
    return {
      ...extracted,
      speechAct: 'visit_book',
      transition: 'want_visit',
      namedProjects: undefined,
      pickName: undefined,
      implicitProjectPick: false,
      askTopic: undefined,
      askTopics: undefined,
      isQuestion: false,
    };
  }
  return extracted;
}

/**
 * Ids whose tap IS the meaning — brief navigation and brief answers. Routing /
 * intent topics read off the row LABEL ("Help me choose", "Under ₹85L",
 * "3 BHK") are noise on these turns and must not merge into the extract.
 */
export function isWaBriefActionId(actionId: string | undefined): boolean {
  const raw = actionId?.trim() ?? '';
  if (!raw) return false;
  // Node rows arrive stamped with the project they were cut for.
  const { aid } = splitProjectStamp(raw);
  return (
    aid === WA_MENU_CHOOSE ||
    aid === WA_MENU_BUDGET ||
    aid === WA_MENU_PROJECTS ||
    aid === WA_MENU_SEE ||
    aid === WA_MENU_KNOW ||
    aid === WA_SIZE_ANY ||
    aid === WA_BUDGET_ANY ||
    aid === WA_TYPE_VILLA ||
    aid === WA_TYPE_PLOT ||
    aid === WA_MENU_NODE ||
    aid.startsWith(WA_NODE_PREFIX) ||
    aid.startsWith(WA_BUDGET_PREFIX) ||
    Boolean(parseWaBhk(aid))
  );
}

function withWaBriefStep(
  state: ConversationState,
  step: 'size' | 'budget' | undefined,
): ConversationState {
  if (state.discover.waBriefStep === step) return state;
  const discover = { ...state.discover };
  if (step === undefined) delete discover.waBriefStep;
  else discover.waBriefStep = step;
  return { ...state, discover };
}

/**
 * Minimal-brief step machine — runs after extract, before goal decide.
 * “Help me choose” opens at the first missing fact; a turn that answers the
 * pending step (tap or typed) advances past it; a pick or the Projects menu
 * abandons the brief. Typing both facts at once clears it entirely.
 */
export function advanceWaBriefState(
  state: ConversationState,
  actionId: string | undefined,
  extracted: { constraints: { bhk?: string; propertyType?: string; budgetMinInr?: number; budgetMaxInr?: number } },
): ConversationState {
  const aid = actionId?.trim() ?? '';
  const c = { ...state.constraints, ...extracted.constraints };
  const sizeKnown = !!c.bhk?.trim() || !!c.propertyType?.trim();
  const budgetKnown = c.budgetMaxInr !== undefined || c.budgetMinInr !== undefined;

  if (aid === WA_MENU_PROJECTS || aid === WA_MENU_SEE || parseWaPickId(aid)) return withWaBriefStep(state, undefined);
  if (aid === WA_MENU_CHOOSE) {
    return withWaBriefStep(state, !sizeKnown ? 'size' : !budgetKnown ? 'budget' : undefined);
  }
  if (aid === WA_MENU_BUDGET) return withWaBriefStep(state, 'budget');

  let step = state.discover.waBriefStep;
  if (!step) return state;
  const sizeAnswered = aid === WA_SIZE_ANY || !!extracted.constraints.bhk || !!extracted.constraints.propertyType;
  const budgetAnswered =
    aid === WA_BUDGET_ANY ||
    extracted.constraints.budgetMaxInr !== undefined ||
    extracted.constraints.budgetMinInr !== undefined;
  if (step === 'size' && sizeAnswered) step = !budgetKnown && aid !== WA_BUDGET_ANY ? 'budget' : undefined;
  if (step === 'budget' && budgetAnswered) step = undefined;
  return withWaBriefStep(state, step);
}

/** Keep the step in sync when discover itself starts the brief (help-me asks). */
export function syncWaBriefFromGoal(
  state: ConversationState,
  goal: { kind: string; slot?: string },
): ConversationState {
  if (goal.kind === 'probe' && (goal.slot === 'bhk' || goal.slot === 'propertyType')) {
    return withWaBriefStep(state, 'size');
  }
  if (goal.kind === 'probe' && goal.slot === 'budget') return withWaBriefStep(state, 'budget');
  if (goal.kind === 'commit') return withWaBriefStep(state, undefined);
  return state;
}
