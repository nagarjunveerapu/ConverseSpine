/**
 * WhatsApp project-first packer — builder-allotted book, not Advisor brief.
 * See docs/lld/WA_PROJECT_FIRST_LLD.md
 */
import type { ConversationState, TurnGoal } from '../engine/types.js';
import { HANDOFF_QUESTIONS } from '../engine/book-questions.js';
import type { Extracted } from '../engine/types.js';
import { currentShortlist, focusedRef, projectSeenFacets } from '../engine/entity-store.js';
import { humanizeMediaKind, normalizeMediaAssetKind } from '../engine/media-asset.js';
import type { SeenFacet } from '../engine/entity-store.js';
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
/** The mock's Money door, one row per real answer: the payment-plan document… */
export const WA_MONEY_PLAN = 'wa.money.plan';
/** …and the size question as a row of its own, drawn only while it is unanswered. */
export const WA_CONSOLE_SIZES = 'wa.console.sizes';
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
/**
 * The file has SECTIONS, and a section opens onto its own screen. Money and The
 * unit complete the set the root offers; the other five already had ids.
 */
export const WA_NODE_MONEY = 'wa.node.money';
export const WA_NODE_UNIT = 'wa.node.unit';
/**
 * One sub-topic inside a section — `wa.sub.<node>.<topic>`. The node is IN the
 * id, so a tap that arrives days later still knows which screen drew it and
 * which screen to draw again underneath the answer.
 */
export const WA_SUB_PREFIX = 'wa.sub.';
/** Send one document — `wa.doc.<asset_kind>`, the kinds the media layer speaks. */
export const WA_DOC_PREFIX = 'wa.doc.';
/** Up one level: back to the file's sections. */
export const WA_BACK_FILE = 'wa.back.file';
/** Put another project beside this one — the id the speech-act catalog knows. */
export const WA_COMPARE = 'compare_projects';

/** Everything the project has on file, in one place — brochure and all. */
export const WA_NODE_MEDIA = 'wa.node.media';

/**
 * The file's sections, in the order the root menu draws them.
 *
 * Time sits LAST because the root can hold seven body rows and the tail is what
 * gives way — and Time's whole content (the possession line) is already printed
 * on the card above the list, so it is the one section a buyer loses nothing by
 * reaching one tap later.
 */
export const WA_FILE_NODES = ['money', 'trust', 'place', 'life', 'unit', 'media', 'time'] as const;
export type WaFileNode = (typeof WA_FILE_NODES)[number];

const NODE_ID: Record<WaFileNode, string> = {
  money: WA_NODE_MONEY,
  trust: WA_NODE_TRUST,
  place: WA_NODE_PLACE,
  life: WA_NODE_LIFE,
  time: WA_NODE_TIME,
  unit: WA_NODE_UNIT,
  media: WA_NODE_MEDIA,
};

const NODE_TITLE: Record<WaFileNode, string> = {
  money: 'Money',
  trust: 'Trust & legal',
  place: 'Place',
  life: 'Life',
  time: 'Time',
  unit: 'The unit',
  media: 'Brochure & photos',
};

/**
 * Which section a document belongs under — the founder's "Trust amalgamated
 * with Media": a legal sub-topic offers its own paperwork, the unit offers the
 * floor plan for the size the buyer gave, money offers the payment schedule.
 */
const DOC_NODE: Record<string, WaFileNode> = {
  brochure: 'life',
  payment_plan: 'money',
  price_sheet: 'money',
  revenue_sharing_model: 'money',
  floor_plan: 'unit',
  site_image: 'unit',
  master_plan: 'place',
  location_map: 'place',
  kmz_layout: 'place',
  legal_agreement: 'trust',
  ownership_certificate: 'trust',
  allotment_letter: 'trust',
  soil_report: 'trust',
  crop_yield_report: 'life',
};

/** Which section a tap belongs to — the id says so, no state to consult. */
export function waNodeOf(actionId: string | undefined): WaFileNode | undefined {
  if (!actionId) return undefined;
  const { aid } = splitProjectStamp(actionId.trim());
  for (const n of WA_FILE_NODES) if (aid === NODE_ID[n]) return n;
  if (aid.startsWith(WA_SUB_PREFIX)) {
    const node = aid.slice(WA_SUB_PREFIX.length).split('.')[0];
    return (WA_FILE_NODES as readonly string[]).includes(node ?? '')
      ? (node as WaFileNode)
      : undefined;
  }
  if (aid.startsWith(WA_DOC_PREFIX)) return DOC_NODE[aid.slice(WA_DOC_PREFIX.length)];
  // Money's rows shipped before the sections did and stay exactly as they are.
  if (aid === WA_MONEY_TOTAL || aid === WA_MONEY_EMI || aid === WA_MONEY_PLAN) return 'money';
  if (aid === WA_CONSOLE_SIZES || aid.startsWith(WA_MONEY_BHK_PREFIX)) return 'unit';
  return undefined;
}

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
  if (aid === WA_MENU_NODE || aid === WA_BACK_FILE) return 'tell me more about this project';
  if (aid === WA_NODE_MONEY) return 'what does it cost';
  if (aid === WA_NODE_UNIT) return 'which units and sizes are available';
  // The shelf is drawn by the packer and spoken by the console screen; the
  // utterance only has to keep the engine on this project, not answer.
  if (aid === WA_NODE_MEDIA) return 'tell me more about this project';
  // Sub-topics speak the same closed-set phrases their section does, cut to one
  // question. No new pattern is introduced anywhere — the id picks a sentence
  // the engine already parses (P7: the lane is the corpus, never a new regex).
  if (aid.startsWith(WA_SUB_PREFIX)) {
    const topic = aid.slice(WA_SUB_PREFIX.length);
    const said: Record<string, string> = {
      'trust.rera': 'what is the rera number',
      'trust.khata': 'what is the khata type',
      'trust.ec': 'is the encumbrance certificate available',
      'trust.approvals': 'which authority approved the project',
      'place.metro': 'how far is the metro station',
      'place.schools': 'what schools are nearby',
      'place.hospitals': 'what hospitals are nearby',
      'place.commute': 'how long is the commute to work',
      'life.amenities': 'what amenities does it have',
      'life.spec': 'how big is the project',
      'time.possession': 'when is possession',
      'time.phases': 'what is the phase wise possession schedule',
      'unit.sizes': 'which units and sizes are available',
    };
    return said[topic];
  }
  // A document row means "send me that file" — the phrasing requestedMediaKinds
  // already reads, so the existing media path does the sending.
  if (aid.startsWith(WA_DOC_PREFIX)) {
    const kind = aid.slice(WA_DOC_PREFIX.length);
    return kind ? `share the ${humanizeMediaKind(kind)}` : undefined;
  }
  // Money rows speak the phrases the closed sets already parse — "all-in cost
  // with all charges" is wantsCostBreakdown's own vocabulary, so a Total-cost
  // tap reaches the landed-cost sheet instead of reprinting the board's price.
  if (aid === WA_MONEY_TOTAL) return 'what is the all-in cost with all charges';
  if (aid === WA_MONEY_PLAN) return 'share the payment plan';
  if (aid === WA_CONSOLE_SIZES) return 'which units and sizes are available';
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
  /**
   * The id the buyer just tapped. Navigation has no state to keep: the id says
   * which level of the file this turn is on, so a tap from an old message opens
   * the screen it was drawn under even after a restart.
   */
  actionId?: string;
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
  /** The documents themselves — a section names the files it can send. */
  mediaAssets?: ReadonlyArray<{
    assetId: string;
    kind: string;
    title?: string;
    unitTypeFilter?: string;
  }>;
  /** The township's numbers — what Life says when the amenity list is a gap. */
  spec?: {
    totalAcres?: number;
    towerCount?: number;
    openSpacePct?: number;
    amenitiesSqft?: number;
    totalUnits?: number;
    waterSupply?: string;
    powerBackup?: string;
    constructionTech?: string;
  };
  approvalAuthority?: string;
  registrationScope?: string;
  reraApplicability?: string;
  naStatus?: string;
  loanEligibility?: string;
  microMarket?: string;
  startingPriceDisplay?: string;
  phaseNote?: string;
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

/** The unit whose type carries the buyer's size — "2 BHK" matches "2 BHK Comfort" too. */
function bhkMatchedUnit(
  units: ReadonlyArray<{ unitType: string }>,
  bhk: string,
): { unitType: string } | undefined {
  const n = /(\d+)/.exec(bhk)?.[1];
  if (n) {
    const re = new RegExp(`\\b${n}\\s*BHK`, 'i');
    return units.find((u) => re.test(u.unitType));
  }
  // Non-BHK sizes (Villa / Plot) match on the word itself.
  const w = bhk.trim().toLowerCase();
  return w ? units.find((u) => u.unitType.toLowerCase().includes(w)) : undefined;
}

/** Section title: the project's own name when it fits Meta's 24, one fixed voice when it doesn't. */
export function waConsoleTitle(projectName: string | undefined): string {
  const name = projectName?.trim();
  const composed = name ? `${name} — the file` : '';
  return composed && composed.length <= 24 ? composed : 'The file';
}

/** Inside a section: the section names itself, so the buyer knows where they are. */
export function waNodeTitle(node: WaFileNode): string {
  // The media shelf is a list of sends, not of things to check.
  if (node === 'media') return 'Files I can send';
  const composed = `${NODE_TITLE[node]} — what to check`;
  return composed.length <= 24 ? composed : NODE_TITLE[node];
}

export interface WaConsoleRowsInput {
  facts?: WaNodeFacts;
  /** The focused project's configs — money-row gates read these, never invent. */
  units?: ReadonlyArray<{ unitType: string; priceDisplay?: string; sizeDisplay?: string }>;
  /** The buyer's own size, already given — Total cost is cut to it, the size row dies. */
  bhk?: string;
  /** The seen ledger for THIS project — a delivered row is not offered again. */
  seen?: ReadonlyArray<SeenFacet>;
  /** Rows that outrank the file (commit-no-size leads with the config ladder). */
  leadRows?: ReadonlyArray<WaListRow>;
}

const NUM = (n: number) => n.toLocaleString('en-IN');

/** Documents of this section, newest-kind-first, one row per kind. */
function docRows(
  facts: WaNodeFacts | undefined,
  node: WaFileNode,
  bhk?: string,
  exclude?: ReadonlySet<string>,
): WaListRow[] {
  const assets = facts?.mediaAssets ?? [];
  if (!assets.length) return [];
  const byKind = new Map<string, typeof assets>();
  for (const a of assets) {
    if (DOC_NODE[a.kind] !== node) continue;
    // A topic row that already sends this document must not be offered twice —
    // "Payment plan" and "Payment plan · document · 1 file" are one row.
    if (exclude?.has(a.kind)) continue;
    byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  }
  const rows: WaListRow[] = [];
  for (const [kind, list] of byKind) {
    // A floor plan bound to the buyer's own size says so — "the floor plan for
    // YOUR 2 BHK" is a different offer from "a floor plan".
    const mine = bhk
      ? list.find((a) => a.unitTypeFilter && bhkMatchedUnit([{ unitType: a.unitTypeFilter }], bhk))
      : undefined;
    // The count has to be what the tap will actually send. A project with four
    // floor plans, one per size, does not owe a 2 BHK buyer four files — saying
    // "4 files" under a row titled "Floor plan — 2 BHK" promises three that
    // belong to somebody else's home.
    const sendable = mine
      ? list.filter(
          (a) => !a.unitTypeFilter || bhkMatchedUnit([{ unitType: a.unitTypeFilter }], bhk!),
        )
      : list;
    rows.push(docRow(kind, sendable.length, mine?.unitTypeFilter));
  }
  return rows;
}

/**
 * A row that will put a file on the buyer's phone must SAY so — "document · 1
 * file" read like a label, not a promise, and the buyer could not tell which
 * rows answer in words and which ones send something. The paperclip is the tell.
 */
function docRow(kind: string, files: number, unitTypeFilter?: string): WaListRow {
  const label = humanizeMediaKind(kind);
  const title = unitTypeFilter
    ? `${label[0]!.toUpperCase()}${label.slice(1)} — ${unitTypeFilter}`
    : `${label[0]!.toUpperCase()}${label.slice(1)}`;
  const noun = kind === 'site_image' ? 'photo' : 'file';
  return {
    id: `${WA_DOC_PREFIX}${kind}`,
    title: clip(title, 24),
    description: `📎 sends ${files} ${noun}${files > 1 ? 's' : ''}`,
  };
}

/**
 * The whole shelf: every kind of file the project holds, in one screen. The
 * documents still sit with their topics — this is the buyer who wants "just
 * send me the brochure and the plans" and should not have to guess which
 * section a file was filed under.
 */
function allDocRows(facts: WaNodeFacts | undefined, bhk?: string): WaListRow[] {
  const assets = facts?.mediaAssets ?? [];
  if (!assets.length) return [];
  const byKind = new Map<string, typeof assets>();
  for (const a of assets) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  // Brochure first — it is the one file every buyer asks for by name.
  const order = [...byKind.keys()].sort(
    (a, b) => (a === 'brochure' ? -1 : 0) - (b === 'brochure' ? -1 : 0),
  );
  const rows: WaListRow[] = [];
  for (const kind of order) {
    const list = byKind.get(kind)!;
    const mine = bhk
      ? list.find((a) => a.unitTypeFilter && bhkMatchedUnit([{ unitType: a.unitTypeFilter }], bhk))
      : undefined;
    const sendable = mine
      ? list.filter((a) => !a.unitTypeFilter || bhkMatchedUnit([{ unitType: a.unitTypeFilter }], bhk!))
      : list;
    rows.push(docRow(kind, sendable.length, mine?.unitTypeFilter));
  }
  return rows;
}

/** What each section can honestly say on its own row of the file. */
function sectionHint(
  node: WaFileNode,
  facts: WaNodeFacts | undefined,
  units: ReadonlyArray<{ unitType: string; sizeDisplay?: string }>,
): string | undefined {
  switch (node) {
    case 'money':
      return 'all-in, EMI, payment plan';
    case 'trust': {
      const bits = [
        facts?.reraNumber?.trim() || facts?.phases?.some((p) => p.reraNumber?.trim()) ? 'RERA' : '',
        facts?.khata?.trim() ?? '',
        facts?.ecStatus?.trim() ? 'EC' : '',
        facts?.mediaAssets?.some((a) => DOC_NODE[a.kind] === 'trust') ? 'documents' : '',
      ].filter(Boolean);
      return bits.length ? bits.join(' · ') : undefined;
    }
    case 'place': {
      const bits = [
        facts?.location?.metroStations?.length ? 'metro' : '',
        facts?.location?.schools?.length ? 'schools' : '',
        facts?.location?.hospitals?.length ? 'hospitals' : '',
      ].filter(Boolean);
      return bits.length ? bits.join(' · ') : facts?.microMarket?.trim();
    }
    case 'life': {
      const s = facts?.spec;
      const bits = [
        s?.amenitiesSqft ? `${NUM(s.amenitiesSqft)} sqft amenities` : '',
        s?.totalAcres ? `${NUM(s.totalAcres)} acres` : '',
        !s?.amenitiesSqft && !s?.totalAcres && facts?.amenities?.length
          ? facts.amenities.slice(0, 3).join(' · ')
          : '',
      ].filter(Boolean);
      return bits.length ? bits.join(' · ') : undefined;
    }
    case 'time':
      return facts?.possession?.trim() || 'dates and status';
    case 'unit': {
      const bits = [
        units.length ? 'sizes' : '',
        facts?.mediaKinds?.includes('floor_plan') ? 'floor plan' : '',
        facts?.mediaKinds?.includes('site_image') ? 'views' : '',
      ].filter(Boolean);
      return bits.length ? bits.join(' · ') : undefined;
    }
    case 'media': {
      const n = facts?.mediaAssets?.length ?? 0;
      return n ? `everything on file — ${n} file${n > 1 ? 's' : ''} to send you` : undefined;
    }
  }
}

/** True when the record can back this section at all — an empty section is never drawn. */
function sectionHasData(
  node: WaFileNode,
  facts: WaNodeFacts | undefined,
  units: ReadonlyArray<{ unitType: string }>,
): boolean {
  switch (node) {
    case 'money':
      return units.length > 0 || Boolean(facts?.startingPriceDisplay?.trim());
    case 'trust':
      return Boolean(
        facts?.reraNumber?.trim() ||
          facts?.khata?.trim() ||
          facts?.ecStatus?.trim() ||
          facts?.naStatus?.trim() ||
          facts?.approvalAuthority?.trim() ||
          facts?.phases?.some((p) => p.reraNumber?.trim()) ||
          facts?.mediaAssets?.some((a) => DOC_NODE[a.kind] === 'trust'),
      );
    case 'place':
      return locationHasData(facts?.location) || Boolean(facts?.microMarket?.trim());
    case 'life':
      return Boolean(facts?.amenities?.length || facts?.spec);
    case 'time':
      return Boolean(facts?.possession?.trim() || facts?.phases?.some((p) => p.possession?.trim()));
    case 'unit':
      return units.length > 0;
    case 'media':
      return Boolean(facts?.mediaAssets?.length);
  }
}

/**
 * THE file — the root menu is the project's SECTIONS, not a flat pile of
 * answers. A section is a place you can stand: it stays on the list whether or
 * not you have been inside it, because navigation you can only use once is not
 * navigation. A section is drawn only when the record can back it.
 *
 * The one non-section row is the hybrid the founder chose: `Total cost — 2 BHK`,
 * already cut to the size the buyer gave, stays one tap from the root because it
 * is the question almost everyone asks. It obeys the seen ledger and disappears
 * once delivered; everything else about money lives inside Money.
 *
 * infoCount is the all-seen signal — 0 means the record backs nothing at all.
 */
export function waConsoleRows(input: WaConsoleRowsInput): { rows: WaListRow[]; infoCount: number } {
  const facts = input.facts;
  const units = input.units ?? facts?.configurations ?? [];
  const bhk = input.bhk?.trim() || undefined;
  const seen = new Set(input.seen ?? []);
  const lead = [...(input.leadRows ?? [])];

  const hybrid: WaListRow[] = [];
  // Landed cost is per-unit arithmetic, so the row exists only when a unit
  // actually resolves for the size in hand.
  if (!lead.length && !seen.has('total')) {
    if (bhk && bhkMatchedUnit(units, bhk)) {
      hybrid.push({
        id: WA_MONEY_TOTAL,
        title: clip(`Total cost — ${bhk}`, 24),
        description: 'all charges counted in',
      });
    } else if (units.length === 1) {
      hybrid.push({ id: WA_MONEY_TOTAL, title: 'All-in cost', description: 'all charges counted in' });
    }
  }

  const sections: WaListRow[] = [];
  for (const node of WA_FILE_NODES) {
    if (!sectionHasData(node, facts, units)) continue;
    const hint = sectionHint(node, facts, units);
    sections.push({
      id: NODE_ID[node],
      title: NODE_TITLE[node],
      ...(hint ? { description: clip(hint, 72) } : {}),
    });
  }
  // Returns is a section too, but only for a product that actually reports a
  // yield — a family apartment never volunteers one.
  if (hasReturnsData(facts?.marketIntel, facts?.investment)) {
    sections.push({ id: WA_NODE_LATER, title: 'Returns', description: 'yield, appreciation, exit' });
  }

  // The three standing acts close every file screen. 10 rows is Meta's ceiling,
  // so sections give way from the tail (Returns first) — never the way out.
  const acts: WaListRow[] = [
    { id: 'visit_book', title: 'Book a visit', description: 'pick a day and a time' },
    { id: WA_COMPARE, title: 'Compare with another' },
    { id: WA_MENU_PROJECTS, title: 'Switch project' },
  ];
  const body = [...lead, ...hybrid, ...sections].slice(0, 10 - acts.length);
  // infoCount is the "you're done" signal, and it counts ANSWERS the buyer has
  // not seen — not sections. Sections never empty (that is the point of them),
  // so counting rows would mean the console could never say "you've been
  // through the full file" again.
  const answerable: SeenFacet[] = [];
  if (facts?.mediaKinds?.includes('brochure')) answerable.push('brochure');
  if ((bhk && bhkMatchedUnit(units, bhk)) || units.length === 1) answerable.push('total');
  if (facts?.mediaKinds?.includes('payment_plan')) answerable.push('plan');
  if (units.length) answerable.push('emi');
  for (const node of ['trust', 'place', 'life', 'time'] as const) {
    if (sectionHasData(node, facts, units)) answerable.push(node);
  }
  if (hasReturnsData(facts?.marketIntel, facts?.investment)) answerable.push('later');
  return {
    rows: [...body, ...acts],
    infoCount: lead.length + answerable.filter((f) => !seen.has(f)).length,
  };
}

/**
 * A section's own screen: which part of it do you want. Every sub-row is gated
 * on the exact field its answer reads, the section's documents sit with the
 * topics they belong to (the founder's "Trust amalgamated with the media"), and
 * the way back is a row because WhatsApp has no back button.
 */
export function waNodeMenuRows(
  node: WaFileNode,
  input: WaConsoleRowsInput,
): { rows: WaListRow[]; infoCount: number } {
  const facts = input.facts;
  const units = input.units ?? facts?.configurations ?? [];
  const bhk = input.bhk?.trim() || undefined;
  // Inside a section, a topic is a place and stays; an ANSWER that was already
  // delivered does not come round again — the same law as the file's own rows.
  const seen = new Set(input.seen ?? []);
  const sub = (topic: string, title: string, hint?: string): WaListRow => ({
    id: `${WA_SUB_PREFIX}${node}.${topic}`,
    title: clip(title, 24),
    ...(hint?.trim() ? { description: clip(hint.trim(), 72) } : {}),
  });
  const rows: WaListRow[] = [];
  /** Document kinds a topic row above already sends. */
  const covered = new Set<string>();

  switch (node) {
    case 'money': {
      if (!seen.has('total')) {
        if (bhk && bhkMatchedUnit(units, bhk)) {
          rows.push({ id: WA_MONEY_TOTAL, title: clip(`Total cost — ${bhk}`, 24), description: 'all charges counted in' });
        } else if (units.length) {
          rows.push({ id: WA_MONEY_TOTAL, title: 'All-in cost', description: 'all charges counted in' });
        }
      }
      if (units.length && !seen.has('emi')) {
        rows.push({ id: WA_MONEY_EMI, title: 'Monthly EMI', description: 'what it costs per month' });
      }
      if (facts?.mediaKinds?.includes('payment_plan')) {
        covered.add('payment_plan');
        if (!seen.has('plan')) {
          rows.push({ id: WA_MONEY_PLAN, title: 'Payment plan', description: 'the schedule, stage by stage' });
        }
      }
      if (facts?.loanEligibility?.trim()) {
        rows.push(sub('loan', 'Banks & loan', 'who has approved it, and how much'));
      }
      break;
    }
    case 'trust': {
      const rera = facts?.reraNumber?.trim() || facts?.phases?.find((p) => p.reraNumber?.trim())?.reraNumber;
      if (rera) rows.push(sub('rera', 'RERA registration', 'number, scope, applicability'));
      if (facts?.khata?.trim()) rows.push(sub('khata', 'Khata & title', facts.khata));
      if (facts?.ecStatus?.trim()) rows.push(sub('ec', 'Encumbrance (EC)', facts.ecStatus));
      if (facts?.approvalAuthority?.trim() || facts?.naStatus?.trim()) {
        rows.push(sub('approvals', 'Approvals & land use', 'authority, classification'));
      }
      break;
    }
    case 'place': {
      const loc = facts?.location;
      if (loc?.metroStations?.length || loc?.driveTimes?.length) {
        rows.push(sub('metro', 'Metro & commute', 'how long to where you work'));
      }
      if (loc?.schools?.length) rows.push(sub('schools', 'Schools nearby', `${loc.schools.length} on file`));
      if (loc?.hospitals?.length) rows.push(sub('hospitals', 'Hospitals nearby', `${loc.hospitals.length} on file`));
      break;
    }
    case 'life': {
      if (facts?.amenities?.length) {
        rows.push(sub('amenities', 'Amenities', facts.amenities.slice(0, 3).join(' · ')));
      }
      const s = facts?.spec;
      if (s) {
        const bits = [
          s.totalAcres ? `${NUM(s.totalAcres)} acres` : '',
          s.towerCount ? `${s.towerCount} towers` : '',
          s.openSpacePct ? `${s.openSpacePct}% open` : '',
        ].filter(Boolean);
        rows.push(sub('spec', 'Size & layout', bits.join(' · ')));
      }
      break;
    }
    case 'time': {
      if (facts?.possession?.trim()) rows.push(sub('possession', 'Possession', facts.possession));
      if (facts?.phases?.some((p) => p.possession?.trim())) {
        rows.push(sub('phases', 'Phase schedule', 'what hands over when'));
      }
      break;
    }
    case 'unit': {
      if (units.length) {
        const kinds = [...new Set(units.map((u) => u.unitType.trim()).filter(Boolean))].slice(0, 4);
        rows.push({
          id: WA_CONSOLE_SIZES,
          title: 'Sizes & options',
          ...(kinds.length ? { description: clip(kinds.join(' · '), 72) } : {}),
        });
      }
      break;
    }
    // Media is not a topic with sub-topics — it is the shelf. Every file the
    // project has, in one screen, whichever section it also sits under.
    case 'media':
      break;
  }

  const docs = node === 'media' ? allDocRows(facts, bhk) : docRows(facts, node, bhk, covered);
  const infoCount = rows.length + docs.length;
  // 8 topic slots leaves the way back and one act inside Meta's 10.
  const body = [...rows, ...docs].slice(0, 8);
  return {
    rows: [
      ...body,
      { id: WA_BACK_FILE, title: '← Back to the file' },
      { id: 'visit_book', title: 'Book a visit', description: 'pick a day and a time' },
    ],
    infoCount,
  };
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

function jobButtons(singleProject: boolean): Array<{ id: string; title: string }> {
  // Unfocused answers only — every focused turn gets the console list instead.
  const escape = singleProject
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
 * The size ladder for a commit with no size known — the project's own configs,
 * price-free: a console row never prints a ₹ figure, the tapped answer does.
 */
function waConfigLadderRows(
  units: ReadonlyArray<{ unitType: string; priceDisplay?: string; sizeDisplay?: string }>,
): WaListRow[] {
  const rows: WaListRow[] = [];
  // Two configs can share a BHK count ("2 BHK" and "2 BHK Comfort"), so the
  // count alone is not an identity. WhatsApp rejects a list whose row ids
  // collide — and rejects it silently, taking the answer down with it.
  const taken = new Set<string>();
  // 7 configs is the most that still leaves room for the standing doors inside
  // Meta's 10-row ceiling — and the pick list promises this same count.
  for (const u of units.slice(0, WA_MAX_CONFIG_ROWS)) {
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
      ...(u.sizeDisplay?.trim() ? { description: clip(u.sizeDisplay, 72) } : {}),
    });
  }
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
    id === WA_MONEY_PLAN ||
    id === WA_CONSOLE_SIZES ||
    id.startsWith(WA_MONEY_BHK_PREFIX) ||
    // Node rows outlive the state that drew them the same way money rows do —
    // a "Trust & legal" tap from last night's card must answer THAT project.
    // Legacy ids (visit_book, answer_media) stay unstamped: the speech-act
    // catalog resolves them by EXACT id, and their wire shape already shipped.
    id.startsWith(WA_NODE_PREFIX) ||
    id === WA_MENU_NODE ||
    // Sub-topics, documents and the way back are all "…of THIS project" too —
    // a Trust sub-row tapped tomorrow must open tonight's project, not the
    // book. Same law as the money rows: the id carries its context.
    id.startsWith(WA_SUB_PREFIX) ||
    id.startsWith(WA_DOC_PREFIX) ||
    id === WA_BACK_FILE;
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

  // THE console — every focused turn past the visit chrome gets ONE menu:
  // "{name} — what to check". Four branch-grown menus ("Costs —", "What next",
  // "Pick a size", the node list) drifted apart here; now one builder gates
  // every row on the record and drops what the seen ledger says was delivered.
  if (focus) {
    const units = input.focusUnits ?? input.focusFacts?.configurations ?? [];
    const bhk = state.constraints?.bhk?.trim() || undefined;
    // A pick with the size still open leads with the project's OWN sizes — the
    // book design's step 2, price-free, never a toll gate on the way to money.
    const leadRows =
      goal.kind === 'commit' && !bhk && units.length >= 2 ? waConfigLadderRows(units) : [];
    const consoleInput: WaConsoleRowsInput = {
      facts: input.focusFacts,
      units,
      ...(bhk ? { bhk } : {}),
      seen: projectSeenFacets(state, focus.projectId),
      leadRows,
    };
    // Which level of the file is this turn on? The tapped id says so — a
    // section opens its own screen, a sub-topic or a document stays inside the
    // section it belongs to (so the next question is one tap, not three), and
    // "← Back to the file" or anything else returns to the sections.
    const node = leadRows.length ? undefined : waNodeOf(input.actionId);
    const { rows } = node
      ? waNodeMenuRows(node, consoleInput)
      : waConsoleRows(consoleInput);
    return {
      kind: 'list',
      button: 'More',
      sections: [
        {
          title: node ? waNodeTitle(node) : waConsoleTitle(focus.projectName),
          rows: stampProject(rows, focus.projectId),
        },
      ],
    };
  }

  if (handoffAnswer || goal.kind === 'answer' || goal.kind === 'commit' || goal.kind === 'shortlist_answer') {
    return { kind: 'buttons', buttons: jobButtons(singleProject || bag.length <= 1) };
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
    // The recall flag outranks booking in the visit machine, so a buyer who
    // already had one visit on the books tapped "Book a visit" for a SECOND
    // project and was read the first one back instead. A tap that says book
    // means book.
    return { ...extracted, speechAct: 'visit_book', transition: 'want_visit', recall: false };
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
  // Payment plan is a document send — the mirror of answer_media, with the
  // asset kind naming which document the row promised.
  if (aid === WA_MONEY_PLAN) {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'media',
      askTopics: ['media'],
      mediaAssetKind: 'payment_plan',
      transition: 'want_details',
      isQuestion: false,
    };
  }
  // The size row asks what's available — an availability answer, never a search.
  if (aid === WA_CONSOLE_SIZES) {
    return {
      ...extracted,
      speechAct: 'answer',
      askTopic: 'availability',
      askTopics: ['availability'],
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
  // A document row IS the ask — the id names the asset kind, so the send must
  // not depend on the canonical sentence surviving a phrase match. It didn't:
  // "share the ownership certificate" matches no media phrase, so tapping the
  // certificate returned a project blurb and no file. The id is the request.
  if (aid.startsWith(WA_DOC_PREFIX)) {
    const kind = normalizeMediaAssetKind(aid.slice(WA_DOC_PREFIX.length));
    if (kind) {
      return {
        ...extracted,
        speechAct: 'answer',
        askTopic: 'media',
        askTopics: ['media'],
        mediaAssetKind: kind,
        transition: 'want_details',
        isQuestion: false,
      };
    }
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
