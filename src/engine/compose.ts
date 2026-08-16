import {
  formatDisclosedForPrompt,
  hasDisclosedRera,
} from './disclosed-facts.js';
import { answerBookQuestion, answerSituation } from './book-questions.js';
import type {
  AnswerTopic,
  CompareMatrixPayload,
  ComposeContext,
  ComposeRequest,
  Constraints,
  EvidenceSet,
  FactKey,
  Match,
  ProbeKind,
  RelaxedDimension,
  TurnGoal,
} from './types.js';

/** Builder-allotted WhatsApp greet — show the book, never the Advisor brief. */
export function waBookFirstGreet(opts: {
  builderName?: string;
  catalog?: {
    priceMinInr?: number;
    projectTypes?: readonly string[];
    microMarkets?: readonly string[];
    total?: number;
  } | null;
}): string {
  const brand = (opts.builderName || '').trim() || 'this builder';
  const types = (opts.catalog?.projectTypes ?? []).filter(Boolean).slice(0, 3);
  const markets = (opts.catalog?.microMarkets ?? []).filter(Boolean).slice(0, 3);
  const min = opts.catalog?.priceMinInr ?? 0;
  const bits = [
    types.length ? types.join(', ') : 'homes',
    ...(markets.length ? [markets.join(', ')] : []),
    ...(min > 0 ? [`from about ${formatInr(min)}`] : []),
  ];
  // The console welcome (mock parity): three quiet doors, no catalog dump.
  // The corridors/price line moved behind "See everything" — the book screen.
  if ((opts.catalog?.total ?? 0) > 1) {
    return `Welcome to *${brand}*.\n\nI can help you shortlist, compare, or book a visit.\n\nWhat are you looking for?`;
  }
  return `Welcome to *${brand}*. ${bits.join(' — ')}.\n\nHere's the book. Pick a project, or tell me a size if you want me to filter.`;
}

/**
 * What the BOOK can say about a topic before any project is picked.
 *
 * Two honest shapes, never a third. The book has its own price spread, so
 * "price?" at the door gets a number. Everything else — RERA, possession,
 * amenities, floor plans — is registered per project, so the answer is where
 * the fact lives plus the list to pick from. Both are answers; "tell me a size
 * or budget" was not, and that is what this replaces.
 *
 * Returns '' when there is nothing honest to lead with, so the list stands alone.
 */
function bookLevelAnswer(topic: AnswerTopic, ev: EvidenceSet): string {
  const min = ev.catalog?.priceMinInr ?? 0;
  const max = ev.catalog?.priceMaxInr ?? 0;
  switch (topic) {
    case 'price':
    case 'emi':
      if (min <= 0) return '';
      return max > min
        ? `Across the book, homes run ${formatInr(min)} – ${formatInr(max)}. `
        : `Homes here start at ${formatInr(min)}. `;
    // Registration is per project, and NOT every project has one — a managed
    // plantation on agricultural land sits outside RERA entirely. "Each project
    // carries its own RERA registration" was the older line here and it is a
    // false promise on part of the book, so the shape is "where it lives", not
    // "everything has one".
    case 'legal':
      return `RERA and title papers are registered per project — name one and I'll give you exactly what's on file for it. `;
    case 'availability':
    case 'property_type':
      return `Sizes and live availability are per project. `;
    case 'media':
      return `Floor plans and brochures are held per project. `;
    case 'amenities':
      return `Amenities differ by project. `;
    case 'location':
      return `We're spread across several corridors, and the answer changes by which one. `;
    // The catch-all topic: delivery timeline, builder track record, payment
    // plan and investment framing all land on `overview`, so this sentence has
    // to be true of every one of them.
    case 'overview':
      return `That's held per project — name one and I'll pull what's on file. `;
    // `education` is platform literacy ("what is khata?"), answerable WITHOUT a
    // project. Saying "that's per project" about it would be a dodge, and a
    // false one. `compare` needs two projects on the board to mean anything.
    case 'education':
    case 'compare':
    default:
      return '';
  }
}

/**
 * Is this line the one the buyer just read? Templates are exempt from the W3
 * repeat guard (a hold's terms SHOULD restate verbatim), so a template that is
 * a nudge rather than a commitment has to check for itself.
 */
function repeatsPrior(line: string, prior: string | undefined): boolean {
  if (!prior) return false;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const p = norm(prior);
  const l = norm(line);
  return p === l || p.startsWith(l.slice(0, 60));
}

/** Requirement receipt — the buyer sees exactly what the line understood. */
export function waBriefReceipt(c: Constraints | undefined): string {
  if (!c) return '';
  const bits: string[] = [];
  // A bare number here is a size, not a count — never print "Noted: *2*".
  if (c.bhk?.trim()) bits.push(c.bhk.trim().replace(/^(\d+)$/, '$1 BHK'));
  else if (c.propertyType?.trim()) bits.push(c.propertyType.trim());
  if (c.budgetMaxInr !== undefined && c.budgetMinInr !== undefined) {
    bits.push(`${formatInr(c.budgetMinInr)} – ${formatInr(c.budgetMaxInr)}`);
  } else if (c.budgetMaxInr !== undefined) {
    bits.push(`under ${formatInr(c.budgetMaxInr)}`);
  } else if (c.budgetMinInr !== undefined) {
    bits.push(`above ${formatInr(c.budgetMinInr)}`);
  }
  if (!bits.length) return '';
  return `Noted: *${bits.join(' · ')}*. `;
}

/** Buyer-facing noun for a relaxed dimension — never their raw value. */
const RELAXED_NOUN: Record<RelaxedDimension, string> = {
  type: 'that property type',
  area: 'that area',
  size: 'that size',
  budget: 'that budget',
};

/**
 * Lead-in for a shortlist. A list that only exists because part of the ask was
 * relaxed is NOT a fit, and must not be announced as one — broadening exists so
 * the buyer is never dead-ended, not so we can overstate the match.
 */
function relaxedLead(
  relaxed: readonly RelaxedDimension[] | undefined,
  channel?: 'whatsapp' | 'advisor_web',
): string {
  const exact =
    channel === 'advisor_web'
      ? `Based on what you've shared, these look strongest`
      : `Here's what lines up`;
  if (!relaxed?.length) return exact;
  const nouns = relaxed.map((r) => RELAXED_NOUN[r]).filter(Boolean);
  if (!nouns.length) return exact;
  const phrase =
    nouns.length === 1
      ? nouns[0]!
      : `${nouns.slice(0, -1).join(', ')} or ${nouns[nouns.length - 1]!}`;
  return channel === 'advisor_web'
    ? `I couldn't match ${phrase} tightly — here's the closest I can stand behind`
    : `Couldn't nail ${phrase} exactly — here's what we do have`;
}
import {
  affordabilityFromMonthlyText,
  detectPropertyTypes,
  isCostComponentAsk,
  isInventoryAsk,
} from './facts.js';
import { INCOME_SERVICING_RATIO } from './emi.js';
import { humanizeMediaKind, normalizeMediaAssetKind } from './media-asset.js';
import { looksLikeAQuestion, resolveFaqQuestionKeys } from './faq-keys.js';
import { answerRequirements } from './answer-contract.js';
import { speakStickyClarify } from './clarify-outstanding.js';

const PARK_TOPIC_LABEL: Partial<Record<AnswerTopic, string>> = {
  price: 'pricing',
  legal: 'legal details',
  emi: 'EMI',
  amenities: 'amenities',
  availability: 'possession or configs',
  location: 'location',
  media: 'brochure / plans',
  overview: 'project overview',
  property_type: 'property type',
  compare: 'a comparison',
  education: 'a short explainer',
};

/**
 * The arithmetic behind a budget we derived from a monthly instalment.
 *
 * The extractor turns "I can pay 60000 per month" into a budget so the search
 * cuts. Acting on that silently would be putting words in the buyer's mouth —
 * the reply names the instalment, the rate and the tenure it assumed, and the
 * number it arrived at, so a buyer who assumes differently can say so.
 */
function affordabilityLead(buyerText: string | undefined): string {
  const a = affordabilityFromMonthlyText(buyerText ?? '');
  if (!a) return '';
  const basis = a.fromIncome
    ? `Lenders will usually let about ${Math.round(INCOME_SERVICING_RATIO * 100)}% of take-home go to the instalment, so call it ₹${a.monthlyInr.toLocaleString('en-IN')} a month`
    : `At ₹${a.monthlyInr.toLocaleString('en-IN')} a month`;
  return `${basis} — on ${a.ratePercent}% over ${a.tenureYears} years that services about ${formatInr(a.loanInr)} of loan, roughly ${formatInr(a.priceInr)} of home with the usual 20% down. `;
}

/**
 * Facts a buyer named in a long brief that a shortlist cannot answer.
 *
 * "3 bhk in north bangalore, 90 lakhs to 1 crore, possession within a year,
 * and I want to know about home loan options too" is four asks. The search
 * consumed the size and the budget and the reply went quiet on the other two,
 * which reads as not having been heard. Say them back and say where they live.
 */
const CARRIED_LABEL: Partial<Record<FactKey, string>> = {
  possession: 'possession',
  loan_eligibility: 'home loans',
  rera: 'RERA',
  khata: 'khata',
  ec_status: 'the title position',
  stamp_duty: 'stamp duty',
  price_per_sqft: 'the per-sqft rate',
  carpet_area: 'carpet area',
  built_up_area: 'built-up area',
};

function carriedAsks(buyerText: string | undefined): string {
  const labels = [
    ...new Set(
      answerRequirements(buyerText ?? '')
        .map((k) => CARRIED_LABEL[k])
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  if (!labels.length) return '';
  const phrase =
    labels.length === 1
      ? labels[0]!
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]!}`;
  return ` You also asked about ${phrase} — that's per project, so open one and I'll give you its answer.`;
}

function parkContinuation(parked: readonly AnswerTopic[] | undefined): string {
  if (!parked?.length) return '';
  const labels = parked.map((t) => PARK_TOPIC_LABEL[t] ?? t);
  const phrase =
    labels.length === 1
      ? labels[0]!
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]!}`;
  return ` I can cover ${phrase} next if you want.`;
}

/** Buyer asked about loan / banks / LTV — not a generic legal dump. */
function isLoanEligibilityAsk(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  if (answerRequirements(text).includes('loan_eligibility')) return true;
  const keys = resolveFaqQuestionKeys(text);
  return keys.includes('banks') || keys.includes('loan_eligibility');
}

/** Buyer asked about possession / handover timing. */
function isPossessionAsk(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  return resolveFaqQuestionKeys(text).includes('possession');
}

/**
 * A closer is a QUESTION, and a question the engine cannot hear the answer to
 * is worse than no question at all: the simulation had every money reply end in
 * "Would it help if I estimated the total cost…", and "yes" landed on a visit
 * pitch while "no" triggered a full overview dump — declining got you MORE.
 *
 * So the closer's words and the record of what was asked come from one table.
 * `topic` is what a bare yes means; `options` are the named forks a buyer can
 * pick by name instead. Nothing may append a question to a reply without an
 * entry here — that is the whole point of the table.
 */
export interface ComposedOffer {
  /** Verbatim, including the leading space — the reply ends with exactly this. */
  readonly text: string;
  /** What a bare "yes" resolves to. */
  readonly topic: AnswerTopic;
  /** Forks the buyer can name instead of affirming. */
  readonly options: readonly AnswerTopic[];
  /**
   * Whether a bare "yes" should be routed to `topic` — i.e. whether the offer
   * names something the engine can actually deliver. False only for `compare`,
   * which needs a second project this table cannot know about: binding a yes to
   * a question we cannot answer is worse than not hearing it, because the buyer
   * gets a confused reply instead of a next step. Rotation is irrelevant here —
   * a filler closer that names pricing and configs is still a real offer, and
   * treating it as noise is what dropped the second yes in a row.
   */
  readonly binds: boolean;
}

const CLOSERS = {
  // Named `pricing_detail`, not `payment_schedule`: a payment schedule is a
  // builder document (media kind `payment_plan`), not something this engine can
  // compute. Offering it and then answering with the price is a broken promise —
  // the closer says what the `price` topic actually delivers.
  pricing_detail: {
    text: ' I can also take you through the pricing in detail if you are weighing affordability.',
    topic: 'price',
    options: ['price'],
    binds: true,
  },
  possession_configs: {
    text: ' Want the configurations that deliver in that window, or pricing next?',
    topic: 'availability',
    options: ['availability', 'price'],
    binds: true,
  },
  compare_nearby: {
    text: ' If you are comparing projects, I can also explain how this differs from nearby options.',
    topic: 'compare',
    options: ['compare'],
    binds: false,
  },
  total_cost: {
    text: ' Would it help if I estimated the total cost for a specific BHK?',
    topic: 'availability',
    options: ['availability', 'price'],
    binds: true,
  },
  price_or_stock: {
    text: ' Want pricing on a specific size, or shall I check live unit availability?',
    topic: 'price',
    options: ['price', 'availability'],
    binds: true,
  },
  price_or_legal: {
    text: ' I can also share pricing or legal approvals next if that helps the comparison.',
    topic: 'price',
    options: ['price', 'legal'],
    binds: true,
  },
  loan_price_visit: {
    text: ' Want loan eligibility, pricing, or a site visit next?',
    topic: 'emi',
    options: ['emi', 'price'],
    binds: true,
  },
  overview_three: {
    text: ' Want pricing details, unit configurations, or the legal & RERA picture?',
    topic: 'price',
    options: ['price', 'availability', 'legal'],
    binds: true,
  },
  overview_loan: {
    text: ' Curious about loan eligibility, or shall I walk through the configs?',
    topic: 'emi',
    options: ['emi', 'availability'],
    binds: true,
  },
  overview_cost: {
    text: ' Want a cost breakdown next, or how this compares nearby?',
    topic: 'price',
    options: ['price', 'compare'],
    binds: true,
  },
  generic_deeper: {
    text: ' I can go deeper on pricing, legal, or a visit whenever you are ready.',
    topic: 'price',
    options: ['price', 'legal'],
    binds: true,
  },
  generic_compare: {
    text: ' I can also compare this with nearby options if that helps.',
    topic: 'compare',
    options: ['compare'],
    binds: false,
  },
  generic_pricing: {
    text: ' Want pricing next, or a walkthrough of configs?',
    topic: 'price',
    options: ['price', 'availability'],
    binds: true,
  },
  // ── Variants ──────────────────────────────────────────────────────────────
  // Same job, different words. Every one is a table row, so it still binds a
  // bare "yes" — this is a rotation, not free text. Without them the topic
  // routing above was a pure function of topic, so a buyer who asked about
  // price four times got the identical sentence four times.
  // A variant must be a PARAPHRASE of the offer it stands in for — same topic,
  // same options. Bound to 'price' instead of 'availability', this sentence
  // read like the same offer to a buyer and a different one to the engine, so
  // "yes" re-answered the price they already had. Different words, same deal.
  total_cost_alt: {
    text: ' Want me to work out the all-in figure for one of the sizes?',
    topic: 'availability',
    options: ['availability', 'price'],
    binds: true,
  },
  // The BHK-free variant. A plot, a plantation or a villa has no BHK, and
  // offering to "estimate the total cost for a specific BHK" on one reads as a
  // bot reciting an apartment script at a buyer who is not buying an apartment.
  total_cost_unitless: {
    text: ' Want the all-in cost for one of the sizes on file?',
    topic: 'availability',
    options: ['availability', 'price'],
    binds: true,
  },
  price_or_stock_alt: {
    text: ' Want pricing on one of the sizes, or a check on what is still unsold?',
    topic: 'price',
    options: ['price', 'availability'],
    binds: true,
  },
} as const satisfies Record<string, ComposedOffer>;

type CloserId = keyof typeof CLOSERS;

/**
 * What a bare "yes" to this closer actually asks for. A closer that offers to
 * cost a size binds to availability while no size is known — "yes" then means
 * "show me the sizes". Once the buyer HAS picked one, the same yes means the
 * cost of that size, and replying with the size list again is the bot not
 * hearing the answer it just received.
 */
/** Does this closer promise the ALL-IN cost (not the sticker price)? */
export function offerPromisesAllInCost(offer: ComposedOffer): boolean {
  return /total cost|all-in (?:cost|figure)/i.test(offer.text);
}

export function resolveOfferTopic(
  offer: ComposedOffer,
  constraints?: { bhk?: string },
): AnswerTopic {
  if (offerPromisesAllInCost(offer) && constraints?.bhk?.trim()) return 'price';
  return offer.topic;
}

const CLOSER_LIST: readonly ComposedOffer[] = Object.values(CLOSERS);

/**
 * Which offer a finished reply is carrying. A table lookup on the exact strings
 * the table itself emitted — NOT a re-parse of the prose. Re-deriving meaning
 * from rendered words is the bug this whole table exists to kill.
 */
export function composedOfferIn(reply: string): ComposedOffer | undefined {
  const trimmed = reply.trimEnd();
  return CLOSER_LIST.find((c) => c.binds && trimmed.endsWith(c.text.trim()));
}

/** Deterministic index into a pool of n — same seed, same choice. */
function hashPick(n: number, seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 997;
  return h % n;
}

/** Deterministic pick from a pool — same buyer text, same closer. */
function rotate<T>(pool: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 997;
  return pool[h % pool.length]!;
}

/**
 * End-of-reply closer — contextual when we can, lightly rotated otherwise.
 * Avoids the same "Want anything else… or a visit?" after every turn.
 */
function closingCta(opts: {
  buyerText?: string;
  topics?: readonly AnswerTopic[];
  projectName?: string;
  park?: string;
  /** The closer the LAST reply ended with — never say it twice running. */
  priorReply?: string;
  /** Project form, so an apartment script is never read at a plot buyer. */
  projectType?: string;
  /** This reply already GAVE the all-in cost — offering to work it out now
   *  reads as the bot not having heard the answer it just delivered. */
  allInDelivered?: boolean;
}): string {
  if (opts.park) return opts.park;
  const t = (opts.buyerText ?? '').toLowerCase();
  const topics = opts.topics ?? [];
  const pname = opts.projectName || 'this project';

  // Anything that is not a flat has no BHK. Asking a plantation or plot buyer
  // about "a specific BHK" is the awkwardness in non-apartment contexts.
  const unitless =
    !!opts.projectType &&
    !/\b(?:apartment|flat|residence|condo|high[- ]?rise|tower)\b/i.test(opts.projectType);
  // The prior turn's closer, recovered from the table by exact match — the same
  // mechanism that binds a "yes", used here to refuse a repeat.
  const priorText = opts.priorReply ? composedOfferIn(opts.priorReply)?.text.trim() : undefined;

  /**
   * First choice, then its alternates. Skips whatever was just said; falls back
   * to the head when every option has been used, because saying the right thing
   * twice beats saying the wrong thing once.
   */
  const pick = (...ids: readonly CloserId[]): string => {
    const pool = ids.map((id) => CLOSERS[id].text);
    const fresh = pool.filter((text) => text.trim() !== priorText);
    return (fresh.length ? fresh : pool)[
      fresh.length > 1 ? hashPick(fresh.length, opts.buyerText || pname) : 0
    ]!;
  };

  if (isLoanEligibilityAsk(opts.buyerText)) return pick('pricing_detail');
  if (isPossessionAsk(opts.buyerText)) return pick('possession_configs');
  if (topics.includes('price') && topics.includes('location')) return pick('compare_nearby');
  if (topics.includes('price') || /\b(?:price|pricing|cost|how much)\b/.test(t)) {
    // The all-in figure is on screen already — move the conversation on rather
    // than re-offering the very thing the buyer just read.
    if (opts.allInDelivered) return pick('price_or_stock', 'price_or_stock_alt');
    return unitless
      ? pick('total_cost_unitless', 'total_cost_alt')
      : pick('total_cost', 'total_cost_alt');
  }
  if (topics.includes('availability') || /\b(?:config|bhk|inventory|sizes?)\b/.test(t)) {
    return pick('price_or_stock', 'price_or_stock_alt');
  }
  if (topics.includes('location') || /\b(?:location|connect|nearby|metro|airport)\b/.test(t)) {
    return pick('price_or_legal');
  }
  if (topics.includes('legal') || /\b(?:rera|khata|legal)\b/.test(t)) return pick('loan_price_visit');

  // The generic pool carries no `*${pname}*` variant any more: an interpolated
  // closer cannot be matched back to its record, so it could never bind a yes.
  return rotate(
    [CLOSERS.generic_compare.text, CLOSERS.generic_deeper.text, CLOSERS.generic_pricing.text],
    opts.buyerText || topics.join(',') || pname,
  );
}
import { formatUnitConfigLine } from './unit-config.js';
import { matchFitClauses, sensitivityLine } from './sensitivity.js';
import { speakEducation } from './education.js';
import { advisoryFactLines } from './market-intel.js';
import {
  collapseCoverageMarkets,
  inventoryNoun,
  joinPlaceLabels,
} from './coverage-areas.js';

export function buildComposeRequest(
  goal: TurnGoal,
  evidence: EvidenceSet,
  ctx: Omit<ComposeRequest['context'], never> & ComposeRequest['context'],
): ComposeRequest {
  return { goal, evidence, context: ctx };
}

export function renderComposePrompt(req: ComposeRequest): string {
  const { goal, evidence, context } = req;
  const lines: string[] = [];
  if (context.channel === 'advisor_web') {
    lines.push(
      `You are a warm, consultative property advisor on the Naya Advisor web app for ${context.builderName || 'the builder'}.`,
    );
    lines.push(
      `Write ONE short reply (2-4 sentences). Sound advisory — weigh trade-offs only from EVIDENCE, one clear next step. Avoid WhatsApp chrome like "Reply yes to confirm". No markdown headers or bullet dumps.`,
    );
  } else {
    lines.push(
      `You are a warm, concise WhatsApp property advisor for ${context.builderName || 'the builder'}.`,
    );
    lines.push(`Write ONE short reply (2-4 sentences, WhatsApp tone). No markdown headers or bullet dumps.`);
  }
  lines.push(`This turn's GOAL: ${describeGoal(goal, context)}.`);
  if (req.vary) {
    // W3 — anti-repeat retry: the previous draft matched the last bot reply
    // verbatim (see PRIOR CONTEXT's excerpt). Same facts, fresh wording.
    lines.push(
      'IMPORTANT: your previous draft repeated the last bot reply word-for-word. Say it DIFFERENTLY and advance the conversation one concrete step.',
    );
  }
  if (req.repair?.unbacked.length) {
    // W1 — grounding retry: the checker rejected these exact values as not
    // present in EVIDENCE. One more draft, evidence-only.
    lines.push(
      `IMPORTANT: your previous draft was REJECTED — it stated ${req.repair.unbacked.join(', ')} which is NOT in EVIDENCE. Rewrite using ONLY values that appear verbatim in EVIDENCE; if a number isn't there, don't state one.`,
    );
  }
  lines.push('');
  lines.push('EVIDENCE — the ONLY facts you may state:');
  lines.push(renderEvidence(evidence));
  lines.push('');
  const priorBlock = renderPriorContext(context);
  if (priorBlock) {
    lines.push('PRIOR CONTEXT — already established (do not re-open as if new):');
    lines.push(priorBlock);
    lines.push('');
  }
  if (context.buyerName) lines.push(`Buyer's name: ${context.buyerName}.`);
  const c = context.constraints;
  const known = [
    c.location && `area ${c.location}`,
    c.bhk,
    c.budgetMaxInr && `budget ~${formatInr(c.budgetMaxInr)}`,
    c.purpose,
  ].filter(Boolean);
  if (known.length) lines.push(`Known so far: ${known.join(', ')}. Don't re-ask these.`);
  if (context.alreadyShownSameSet) {
    lines.push(`You already showed these exact projects — do NOT relist; advance the conversation.`);
  }
  // A4 — advisor board owns the catalog; chat must not dump *Name* in market, price.
  if (
    context.channel === 'advisor_web' &&
    (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend')
  ) {
    lines.push(
      `CRITICAL: project cards are on the buyer's board from structured JSON. Write 1–2 short sentences of commentary + a clear next step. Do NOT list project names, micro-markets, or prices in the reply.`,
    );
  }
  if (context.buyerText && /\b(which.*better|better for)\b/i.test(context.buyerText)) {
    lines.push(
      `The buyer wants consultative guidance using ONLY the comparison facts — weigh trade-offs honestly, no invented claims.`,
    );
  }
  if (goal.kind === 'answer' && goal.topic === 'legal' && evidence.detail?.reraNumber) {
    const skipRera = hasDisclosedRera(context.disclosedFacts, goal.projectId);
    if (skipRera) {
      lines.push(
        `RERA was already shared — answer the buyer's specific legal facet (banks / EC / title) from EVIDENCE; do NOT re-lead with the full RERA dump or a location/price recap.`,
      );
    } else {
      lines.push(
        `Lead with RERA registration (${evidence.detail.reraNumber}) — do NOT give a generic location/price recap.`,
      );
    }
  }
  if (goal.kind === 'answer' && evidence.education) {
    lines.push(
      `The buyer asked a literacy/definition question — answer ONLY from evidence.education (platform curriculum). Do NOT search projects or invent locality.`,
    );
  }
  if (goal.kind === 'answer' && evidence.detail?.faqs?.length) {
    lines.push(
      `The buyer asked a specific FAQ — answer from the faqs in EVIDENCE first. Do NOT fall back to a generic location/price overview.`,
    );
  }
  if (goal.kind === 'answer' && evidence.faqMiss?.keys.length) {
    lines.push(
      `The buyer asked about ${evidence.faqMiss.keys.join(', ')} but there is NO FAQ answer in EVIDENCE. Say you don't have that detail on file yet — offer pricing, a site visit, or another facet. Do NOT invent payment plans, yields, loan terms, or possession dates.`,
    );
  }
  if (goal.kind === 'answer' && evidence.notices?.length) {
    lines.push(
      `These required facts are NOT in evidence and will be disclosed by the fixed failure speaker: ${evidence.notices.map((f) => f.subject).join(', ')}. Do NOT answer or substitute for them; answer only the supported required facts.`,
    );
  }
  if (goal.kind === 'answer' && goal.topics && goal.topics.length > 1) {
    lines.push(`Answer ALL of these in one reply: ${goal.topics.join(', ')}. Use only EVIDENCE for each.`);
  }
  if (goal.kind === 'answer' && goal.parkedTopics?.length) {
    lines.push(
      `Do NOT answer these now — close by offering them next: ${goal.parkedTopics.join(', ')}.`,
    );
  }
  if (goal.kind === 'answer' && evidence.detail?.name) {
    // W8 — facet answers must anchor WHICH project they're about (dev
    // re-baseline: correct pricing content that never said "Eldorado" reads
    // as unanchored, and multi-project chats lose the thread).
    lines.push(`Name the project (*${evidence.detail.name}*) once, naturally, in your reply.`);
  }
  lines.push('');
  lines.push('RULES: State ONLY facts in EVIDENCE. One natural next-step question. No filler closers.');
  return lines.join('\n');
}

function renderPriorContext(context: ComposeRequest['context']): string {
  const bits: string[] = [];
  if (context.priorTopics?.length) {
    bits.push(`Prior topics: ${context.priorTopics.join(', ')}.`);
  }
  if (context.priorReplyExcerpt) {
    bits.push(`Last bot reply (excerpt): ${context.priorReplyExcerpt}`);
  }
  const facts = formatDisclosedForPrompt(context.disclosedFacts);
  if (facts) bits.push(`Already disclosed:\n${facts}`);
  return bits.join('\n');
}

function describeGoal(g: TurnGoal, ctx?: ComposeContext): string {
  switch (g.kind) {
    case 'greet':
      return ctx?.waProjectFirst
        ? 'greet and invite them to pick a project from the list — do NOT ask area or budget'
        : 'greet and ask what they are looking for';
    case 'orient':
      return 'briefly describe the portfolio and ask area/budget/size';
    case 'clarify_intent':
      return (
        'you did NOT understand what they asked. Say so plainly in one short line and ask ONE ' +
        'clarifying question. State NO facts, figures, places or claims of any kind — you have ' +
        'no evidence for this turn. Do not pitch the portfolio and do not guess what they meant'
      );
    case 'probe':
      return `ask their ${g.slot}`;
    case 'recommend':
      return 'recommend matching projects from EVIDENCE';
    case 'clarify_project_pick':
      return 'ask which shortlisted project they want details on — do not invent a pick';
    case 'clarify_discourse':
      return (
        'you cannot resolve their deixis/compare honestly from the board. Say so in one short line ' +
        'and ask ONE clarifying question — do NOT recycle a project overview'
      );
    case 'shortlist_answer':
      return `answer their ${g.topic} question for EVERY shortlisted project from EVIDENCE — never ask which one to open`;
    case 'advance':
      return 'do NOT relist — nudge forward or ask one missing slot';
    case 'no_fit':
      return 'honestly say nothing fits and state the real starting point';
    case 'ack_reject_recommend':
      return 'acknowledge they passed on the last option and offer alternatives';
    case 'objection':
      return `acknowledge ${g.topic} concern and reframe using EVIDENCE angles only`;
    case 'answer':
      return `answer their ${g.topic} question from EVIDENCE`;
    case 'emi_calculate':
      return 'calculate EMI from the buyer-stated loan principal in EVIDENCE';
    case 'commit':
      return ctx?.waProjectFirst
        ? 'confirm the project they picked in one short line — do NOT dump configurations, price band, or legal/RERA; the list/buttons own next step'
        : 'confirm their project choice and offer next step';
    case 'propose_visit':
      return 'offer to set up a site visit and ask which day works';
    case 'visit_ask':
    case 'visit_propose':
      return 'continue visit setup using the exact copy in EVIDENCE';
    case 'visit_booked':
      return 'confirm the visit is booked';
    case 'hold_propose':
      return 'offer to hold a unit — use the exact proposed copy';
    case 'hold_booked':
      return 'confirm the unit hold outcome — use the exact template';
    case 'visit_recall':
      return 'recall visits from EVIDENCE only';
    case 'recall_constraints':
      return 'recall the buyer brief (area, budget, BHK) from Known so far — do not open a project overview';
    case 'warm_ack':
      return 'warm short ack after visit booked — no escalation';
    case 'handoff':
      return 'reassure a human will follow up';
    case 'smalltalk':
      return 'respond warmly and briefly, then gently ask what property they are looking for';
    default:
      return 'respond helpfully and steer back to property search';
  }
}

function renderEvidence(ev: EvidenceSet): string {
  const out: string[] = [];
  if (ev.matches?.length) {
    out.push(
      'matches:\n' +
        ev.matches
          .map(
            (m) => {
              const fit = matchFitClauses(m);
              return `  - ${m.name} — ${m.microMarket}${priceOf(m) ? `, ${fromPrice(priceOf(m))}` : ''}${fit ? ` (fit: ${fit})` : ''}`;
            },
          )
          .join('\n'),
    );
  }
  if (ev.floor) out.push(`catalog floor: ${ev.floor.display}`);
  if (ev.noMatch) out.push(`no exact match: ${ev.noMatch.reasoning}`);
  if (ev.catalog) {
    out.push(
      `portfolio: ${ev.catalog.projectTypes.join(', ')} in ${ev.catalog.microMarkets.slice(0, 5).join(', ')}`,
    );
  }
  if (ev.detail) {
    out.push(
      `project: ${ev.detail.name} in ${ev.detail.microMarket}${ev.detail.startingPriceDisplay ? `, ${fromPrice(ev.detail.startingPriceDisplay)}` : ''}${ev.detail.reraNumber ? `, RERA ${ev.detail.reraNumber}` : ''}${ev.detail.possession ? `, possession ${ev.detail.possession}` : ''}${ev.detail.phaseNote ? `\n  phase status: ${ev.detail.phaseNote}` : ''}${ev.detail.summary ? `\n  summary: ${ev.detail.summary}` : ''}`,
    );
    if (ev.detail.faqs?.length) {
      out.push(
        `faqs (use these to answer the buyer's question — prefer over generic summary):\n${ev.detail.faqs
          .map((f) => `  - [${f.questionKey}] Q: ${f.question}\n    A: ${f.answer}`)
          .join('\n')}`,
      );
    }
  }
  if (ev.education) {
    out.push(
      `buyer education [${ev.education.topicKey}/${ev.education.jurisdiction}]: ${ev.education.answer}` +
        (ev.education.whatToCheck ? `\n  check: ${ev.education.whatToCheck}` : '') +
        (ev.education.disclaimer ? `\n  disclaimer: ${ev.education.disclaimer}` : ''),
    );
  }
  if (ev.faqMiss?.keys.length) {
    out.push(`faq miss (no Desk row): ${ev.faqMiss.keys.join(', ')}`);
  }
  if (ev.notices?.length) {
    out.push(`required facts unavailable: ${ev.notices.map((f) => f.subject).join(', ')}`);
  }
  if (ev.location) {
    const l = ev.location;
    const bits = [
      l.microMarketOverview,
      l.connectivitySummary,
      l.nearbyPois?.length ? `nearby: ${l.nearbyPois.join('; ')}` : '',
      l.driveTimes?.length ? `drive times: ${l.driveTimes.join('; ')}` : '',
    ].filter(Boolean);
    out.push(`location for ${l.projectName}: ${bits.join(' | ') || l.microMarket}`);
    // S1 — Desk-verified POIs by category; asked categories first, top 3 each.
    // These are the ONLY named places allowed in a location answer.
    for (const f of locationCategoryFacts(l)) {
      out.push(`${f.label} near ${l.projectName}: ${f.pois.map(poiFactLine).join('; ')}`);
    }
  }
  if (ev.media) {
    out.push(
      ev.media.allowed
        ? `media: ${ev.media.title ?? ev.media.assetKind ?? 'asset'}${ev.media.cdnUrl ? ` → ${ev.media.cdnUrl}` : ''}`
        : `media withheld: ${ev.media.reason ?? ev.media.redirectHint ?? 'visit required'}`,
    );
  }
  if (ev.emi) {
    out.push(
      `emi: ${ev.emi.emiFormatted}/mo on ${ev.emi.basisFormatted} at ${ev.emi.ratePercent}% for ${ev.emi.tenureYears} yrs`,
    );
  }
  if (ev.units?.length) {
    out.push(
      `units:\n${ev.units
        .map((u) => `  - ${formatUnitConfigLine(u)}`)
        .join('\n')}`,
    );
  }
  if (ev.visits?.visits.length) {
    out.push(
      `visits:\n${ev.visits.visits.map((v) => `  - ${v.projectName}: ${v.label}${v.confirmed ? ' (confirmed)' : ''}`).join('\n')}`,
    );
  }
  if (ev.pricing) {
    out.push(
      `pricing for ${ev.pricing.projectName}: ${ev.pricing.components.map((c) => `${c.label} ${c.value}`).join('; ')}`,
    );
  }
  if (ev.compare?.tableText) out.push('comparison:\n' + ev.compare.tableText);
  if (ev.objection) {
    out.push(`ack: ${ev.objection.acknowledged}`);
    out.push(`reframe angles:\n${ev.objection.reframeAngles.map((a) => `  - ${a}`).join('\n')}`);
  }
  if (ev.nextSlot) out.push(`missing slot to ask: ${ev.nextSlot}`);
  return out.length ? out.join('\n') : '  (no data — ask a clarifying question, invent nothing)';
}

/** Buyer-facing phrase for a facet asked across the shortlist (honest-miss copy). */
function shortlistTopicLabel(topic: import('./types.js').AnswerTopic): string {
  switch (topic) {
    case 'price':
      return 'pricing';
    case 'emi':
      return 'EMI figures';
    case 'legal':
      return 'the legal papers';
    case 'availability':
      return 'availability';
    case 'location':
      return 'location details';
    case 'property_type':
      return 'the project type';
    default:
      return 'that';
  }
}

/** Stable variant pick — conversational without sounding copy-pasted. */
function voicePick(seed: string | undefined, lines: string[]): string {
  if (!lines.length) return '';
  if (lines.length === 1) return lines[0]!;
  let h = 0;
  const s = seed ?? 'naya';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return lines[h % lines.length]!;
}

export function fallbackReply(req: ComposeRequest): string {
  return tidySentenceEnds(fallbackReplyBody(req));
}

/**
 * Desk copy usually already ends in a period, and the assembly adds its own —
 * "…available in the Brigade legal pack.." reached a buyer. Squeeze the pair
 * and leave ellipses ("hold on…") and decimals ("1.5") alone.
 */
function tidySentenceEnds(reply: string): string {
  return reply.replace(/(?<![.!?])([.!?])\.(?=\s|$)/g, '$1');
}

function fallbackReplyBody(req: ComposeRequest): string {
  const { goal, evidence: ev, context } = req;
  const name = context.buyerName ? ` ${context.buyerName}` : '';
  const seed = context.focusProjectName || context.buyerName || goal.kind;
  switch (goal.kind) {
    case 'greet': {
      const rb = context.returningBuyer;
      if (context.waProjectFirst) {
        return waBookFirstGreet({ builderName: context.builderName, catalog: ev.catalog });
      }
      if (rb && rb.daysSinceLastSeen >= 1) {
        const welcome = rb.buyerName ? `Welcome back, ${rb.buyerName}.` : 'Welcome back.';
        return `${welcome} Still hunting, or picking up where we left off?`;
      }
      // Brand-first — buyer should know which builder's book this is (not a generic Naya line).
      const brand = (context.builderName || '').trim();
      if (brand) {
        return voicePick(seed, [
          `Welcome to *${brand}*${name ? `,${name}` : ''}. I'm your property advisor here — tell me the area and budget you're working with and I'll pull what fits.`,
          `Hi${name} — welcome to *${brand}*. Looking for a home or an investment? Area and budget help me shortlist fast.`,
          `Hey${name}. You're with *${brand}*. What area and budget should I shortlist against?`,
        ]);
      }
      return voicePick(seed, [
        `Hi${name} — looking for a home, or more of an investment? Area and budget help me shortlist fast.`,
        `Hey${name}. Tell me the area and budget you're working with — I'll pull what fits.`,
        `Hi${name}. What are you after — a place to live, or something to invest in?`,
      ]);
    }
    case 'orient': {
      // Was: `We've got ${ev.catalog.projectTypes.join(', ')} on the books` —
      // the raw `project_type` column, so 447 replies opened with
      // "apartment, villa, managed_plantation_estate". A buyer with no project
      // and no brief is owed a question, not the catalog's enum values.
      const from =
        ev.catalog && ev.catalog.priceMinInr > 0 ? `, from ${formatInr(ev.catalog.priceMinInr)}` : '';
      const ack = briefAckPrefix(context.constraints);
      // They asked something real. Say where that fact lives before asking —
      // otherwise the ask is silently dropped and the probe reads as a dodge.
      const lead = goal.askedTopic ? bookLevelAnswer(goal.askedTopic, ev) : '';
      // discover.firstMissingSlot is the ladder's authority — it knows which
      // probes were already ASKED, so it never re-asks a budget the buyer has
      // already declined. firstMissingProbeSlot is the constraints-only
      // fallback for the orient sites that have no state to hand.
      const next = goal.probeSlot ?? firstMissingProbeSlot(context.constraints);
      const ask = next ? probeCopy(next) : 'Which area, budget, and size are you thinking?';
      if (lead) return `${ack}${lead}${ask}`;
      return `${ack}We've got homes on the books${from}. ${ask}`;
    }
    case 'clarify_intent': {
      if (context.waProjectFirst) {
        // Was: "I don't want to guess wrong on that. Tell me a size or budget…"
        // — one defensive sentence answering 65 different situations, from "are
        // you a bot?" to "what's the cheapest one?". Refusing to guess is right;
        // leading with the refusal and then asking for a brief the buyer never
        // offered is what reads as evasive. Say what the book HAS first, so even
        // a miss leaves the buyer with something true, then ask once.
        const total = ev.catalog?.total ?? 0;
        const markets = (ev.catalog?.microMarkets ?? []).filter(Boolean).slice(0, 3);
        const min = ev.catalog?.priceMinInr ?? 0;
        const max = ev.catalog?.priceMaxInr ?? 0;
        const have = total > 0 ? `${total} projects` : 'the full book';
        const where = markets.length ? ` across ${joinPlaceLabels(markets)}` : '';
        const band =
          min > 0 && max > min ? `, ${formatInr(min)} – ${formatInr(max)}` : min > 0 ? `, from ${formatInr(min)}` : '';
        return `I'm not sure I followed that one. What I have is ${have}${where}${band} — pick any project below for its details, or tell me a size or budget and I'll cut the book to fit.`;
      }
      // Sticky clarify when we can re-anchor to outstanding job; else generic.
      const sticky = speakStickyClarify({
        phase: context.focusProjectName ? 'focused' : 'discover',
        focusName: context.focusProjectName,
        priorTopics: context.priorTopics,
        constraints: context.constraints,
        channel: context.channel,
      });
      return (
        sticky ??
        voicePick(seed, [
          context.channel === 'advisor_web'
            ? `Don't want to guess — what's the area, budget, or size on your mind?`
            : `Don't want to guess wrong — what's the area, budget, or size you're thinking?`,
          `Quick one — area, budget, or BHK? I'll take it from there.`,
        ])
      );
    }
    case 'probe': {
      // Minimal brief on allotted lines — two questions, anchored to the book.
      if (context.waProjectFirst) {
        if (goal.slot === 'bhk' || goal.slot === 'propertyType') {
          return `Two quick taps and I'll cut the book to fit. First — how much space do you need?`;
        }
        if (goal.slot === 'budget') {
          const min = ev.catalog?.priceMinInr ?? 0;
          const max = ev.catalog?.priceMaxInr ?? 0;
          const spread = min > 0 && max > min ? ` Homes here run ${formatInr(min)} – ${formatInr(max)}.` : '';
          const ackBits = context.constraints.bhk?.trim() || context.constraints.propertyType?.trim();
          const ack = ackBits ? `Got it — ${ackBits}. ` : '';
          return `${ack}And the ceiling you'd rather stay under?${spread} Tap a band, or type a number.`;
        }
      }
      const ack = briefAckPrefix(context.constraints);
      // Same contract as orient: a probe that follows a real question answers
      // it at book level first. Asking "which area?" straight back at "what's
      // the RERA number?" is what reads as a dodge, not the question itself.
      const lead = goal.askedTopic ? bookLevelAnswer(goal.askedTopic, ev) : '';
      return `${ack}${lead}${probeCopy(goal.slot)}`;
    }
    case 'recommend':
    case 'ack_reject_recommend': {
      const ms = (ev.matches ?? []).slice(0, 3);
      // The buyer asked the BOOK something before picking a project. The list is
      // still the right screen; the lead sentence is what makes it an answer.
      const bookLead =
        context.waProjectFirst && goal.kind === 'recommend' && goal.askedTopic
          ? bookLevelAnswer(goal.askedTopic, ev)
          : '';
      // A question about the line or the book itself ("are you a bot?", "which
      // is the cheapest?"). This one IS the reply — the list is the evidence.
      if (context.waProjectFirst && goal.kind === 'recommend' && goal.bookQuestion) {
        // "cheapest" and "most premium" are questions about the WHOLE book, so
        // they are answered from the catalog's own price extremes — a search
        // result set is whatever the last filter left behind, and naming its
        // ends would call some mid-priced project the top of the book.
        const min = ev.catalog?.priceMinInr ?? 0;
        const max = ev.catalog?.priceMaxInr ?? 0;
        const sample = ev.catalog?.sample ?? [];
        const named = (display: string) =>
          display ? sample.find((p) => p.startingPriceDisplay === display)?.name : undefined;
        const minDisplay = min > 0 ? formatInr(min) : '';
        const maxDisplay = max > 0 ? formatInr(max) : '';
        return answerBookQuestion(goal.bookQuestion, {
          builderName: context.builderName ?? '',
          total: ev.catalog?.total ?? (ev.matches?.length ?? 0),
          ...(minDisplay ? { minDisplay } : {}),
          ...(maxDisplay ? { maxDisplay } : {}),
          ...(named(minDisplay) ? { cheapestName: named(minDisplay)! } : {}),
          ...(max > min && named(maxDisplay) ? { premiumName: named(maxDisplay)! } : {}),
          markets: ev.catalog?.microMarkets ?? [],
          ...(context.focusProjectName ? { focusName: context.focusProjectName } : {}),
        });
      }
      // The buyer described their own situation. Answer that first — the list is
      // still what goes on screen underneath it.
      if (context.waProjectFirst && goal.kind === 'recommend' && goal.situation) {
        return answerSituation(goal.situation, {
          builderName: context.builderName ?? '',
          total: ev.catalog?.total ?? (ev.matches?.length ?? 0),
          markets: ev.catalog?.microMarkets ?? [],
        });
      }
      if (!ms.length) {
        if (context.waProjectFirst) {
          const receipt = waBriefReceipt(context.constraints);
          if (receipt) {
            // Honest no-fit for the brief cut — never a silently relaxed list.
            return `${receipt}Nothing in the book fits that exactly. Here's everything — or change the size or budget and I'll re-cut.`;
          }
          return `${bookLead}Here's the book. Pick a project — or tap *Help me choose* and I'll narrow it in two taps.`;
        }
        return `I couldn't find a fresh match with those filters — tell me if you'd like to adjust area or budget?`;
      }
      const pre = goal.kind === 'ack_reject_recommend' ? 'No problem. ' : '';
      // Four-questions rendering (WhatsApp): each match speaks its receipts
      // (Q1 why + Q2 trade-offs), then sensitivity (Q3). Advisor web (A4):
      // cards on the board own the catalog — chat is thin commentary only.
      const list = ms
        .map((m) => {
          const fit = matchFitClauses(m);
          return `*${m.name}* in ${m.microMarket}${priceOf(m) ? `, ${fromPrice(priceOf(m))}` : ''}${fit ? ` — ${fit}` : ''}`;
        })
        .join('; ');
      const advisorWeb = context.channel === 'advisor_web';
      // A4 — board cards carry fit/sensitivity; don't name a "leads today" winner in chat.
      const sensitivity = advisorWeb ? '' : sensitivityLine(ms);
      const tail = sensitivity ? ` ${sensitivity}` : '';
      // Empty-locality widen: speak MARKETS (Devanahalli), never project names
      // as if they were places (Eldorado is a project).
      if (ev.localityWiden?.asked) {
        const markets = collapseCoverageMarkets(
          ev.localityWiden.nearbyAreas?.length
            ? ev.localityWiden.nearbyAreas
            : ms.map((m) => m.microMarket),
          3,
        );
        const noun = inventoryNoun(
          context.constraints.propertyType,
          context.constraints.bhk,
        );
        const places = joinPlaceLabels(markets) || 'nearby areas I cover';
        const exact = ev.localityWiden.exactFitName;
        if (exact) {
          if (advisorWeb) {
            return `${pre}I've only got *${exact}* in *${ev.localityWiden.asked}* for ${noun}. Nearby options are on your board.${tail} Want a closer look at any of these?`;
          }
          // wantsMore after a singleton — list the nearby matches as a widen, not a Sakleshpur fit.
          return `${pre}I've only got *${exact}* in *${ev.localityWiden.asked}* for ${noun}. Nearby: ${list}.${tail} Want details on any of these?`;
        }
        return `${pre}I don't have ${noun} in *${ev.localityWiden.asked}* — I do have ${noun} in ${places}. Want me to show those?`;
      }
      // Some part of the ask had to be relaxed for this list to exist, so it is
      // NOT a fit — say which dimension gave. Dimensions only, never the buyer's
      // raw values: a location capture may be dialogue noise.
      const lead = relaxedLead(ev.relaxed, context.channel);
      const nextAsk = advisorWeb
        ? 'Want a closer look at any of these, or shall we plan a visit?'
        : 'Want details on any of these, or shall I set up a visit?';
      let body: string;
      if (advisorWeb) {
        const n = ms.length;
        const countCue = n === 1 ? '1 match is on your board' : `${n} matches are on your board`;
        body = `${pre}${lead} — ${countCue}.${tail} ${nextAsk}`;
      } else {
        // Receipt first on allotted WA lines — the cut is played back before the list.
        const receipt = context.waProjectFirst ? waBriefReceipt(context.constraints) : '';
        const afford = affordabilityLead(context.buyerText);
        body = `${afford}${bookLead}${afford ? '' : receipt}${pre}${lead}: ${list}.${tail}${carriedAsks(context.buyerText)} ${nextAsk}`;
      }
      // Singleton exact fit — soft nearby CTA (board stays exact until they opt in).
      if (ev.nearbyOffer?.asked && ev.nearbyOffer.nearbyAreas.length && ms.length === 1) {
        const noun = inventoryNoun(
          context.constraints.propertyType,
          context.constraints.bhk,
        );
        const places =
          joinPlaceLabels(collapseCoverageMarkets(ev.nearbyOffer.nearbyAreas, 3)) ||
          'nearby areas I cover';
        body += ` *${ms[0]!.name}* is the only match I have in *${ev.nearbyOffer.asked}* for ${noun}. I also have ${noun} nearby in ${places} — want those too?`;
      }
      return body;
    }
    case 'clarify_project_pick': {
      const ms = (ev.matches ?? []).slice(0, 3);
      if (!ms.length) {
        return 'Which project should I open for details?';
      }
      const list = ms.map((m, i) => `${i + 1}) *${m.name}*`).join(', ');
      return `Which one should I open for details — ${list}?`;
    }
    case 'clarify_discourse': {
      const name = goal.projectName;
      switch (goal.reason) {
        case 'need_pair_to_compare':
          return `I've only opened *${name}* so far — name another project to compare, or I can pull a second option from search.`;
        case 'no_prior_focus':
          return `We're already on *${name}* — there's no earlier project to go back to. Want me to find another option?`;
        case 'ambiguous_alternate': {
          const alts = (goal.alternateNames ?? []).filter(Boolean);
          if (alts.length >= 2) {
            const list = alts.map((n, i) => `${i + 1}) *${n}*`).join(', ');
            return `I've got a few in play besides *${name}* — which one did you mean: ${list}?`;
          }
          return `Which of the other projects on our list did you mean — or stay with *${name}*?`;
        }
        case 'no_alternate':
        default:
          return `I've only got *${name}* on our list so far — want me to find another to compare, or dig deeper into *${name}*?`;
      }
    }
    case 'shortlist_answer': {
      const ms = (ev.matches ?? []).slice(0, 3);
      const facets = ev.shortlistFacet?.facets ?? [];
      const answered = facets.filter((f) => f.perProject.some((p) => p.value));
      if (!answered.length) {
        // Honest miss — an information ask never earns a bare pick-menu.
        const askLabel = facets[0]?.label.toLowerCase() ?? shortlistTopicLabel(goal.topic);
        const list = ms.map((m, i) => `${i + 1}) *${m.name}*`).join(', ');
        const fork = list ? ` Meanwhile, want the full picture on any of them — ${list}?` : '';
        return `I don't have ${askLabel} on file for your shortlist yet — I'll flag it to the team.${fork}`;
      }
      const blocks = answered.map(
        (f) =>
          `*${f.label}*\n${f.perProject
            .map((p) => `• *${p.name}* — ${p.value || 'not on file yet'}`)
            .join('\n')}`,
      );
      return `${blocks.join('\n\n')}\n\nWant the full picture on any one of them, or shall I set up a visit?`;
    }
    case 'advance': {
      // W2 — a focused bare-affirm ("ok"/"yes" with nothing pending) lands
      // here: nudge the DEAL forward, not the search. Soft CTA decline
      // (cta_decline) is a short ack + one NBA — never an overview recycle.
      if (context.focusProjectName) {
        const decline = goal.reason === 'cta_decline';
        const nudge = decline
          ? `No problem — want a site visit to *${context.focusProjectName}*, loan details, or something else on this project?`
          : `Shall I set up a visit to *${context.focusProjectName}*, or hold a unit for you while you decide?`;
        // The buyer already read this and moved on. Saying it again is the bot
        // looping; the honest second move is to stop nudging and offer the way
        // out — their own words, the book, or a person.
        if (!repeatsPrior(nudge, context.priorReplyExcerpt)) return nudge;
        return `I don't want to keep nudging. Tell me what you'd like to know about *${context.focusProjectName}* and I'll pull it — or say "projects" for the full book, or "call me" and our team will reach out.`;
      }
      const lead = ev.matches?.[0]?.name;
      if (ev.nextSlot) return `Those are still the closest fits. ${probeCopy(ev.nextSlot)}`;
      return `Those are the ones that fit${lead ? ` — want full details on *${lead}*, or a site visit?` : '.'}`;
    }
    case 'no_fit': {
      const b = context.constraints.budgetMaxInr ? formatInr(context.constraints.budgetMaxInr) : 'that budget';
      if (ev.constraintGap) {
        const g = ev.constraintGap;
        const loc = g.location ? ` in *${g.location}*` : '';
        const budget = g.budgetDisplay ? ` at ${g.budgetDisplay}` : b !== 'that budget' ? ` at ${b}` : '';
        if (g.alternateProject && g.alternatePriceDisplay) {
          return `No *${g.bhk ?? 'that configuration'}*${budget}${loc} on our books — we do have *${g.alternateProject}* from ${g.alternatePriceDisplay}. Want me to open *${g.alternateProject}*?`;
        }
        return `No *${g.bhk ?? 'that configuration'}*${budget}${loc} on our books. Want to adjust BHK, budget, or area?`;
      }
      if (ev.budgetGap) {
        const g = ev.budgetGap;
        const loc = g.location ? ` in *${g.location}*` : '';
        return `Nothing${loc} starts within ${g.budgetDisplay} — closest on your brief is *${g.closestName}* from ${g.closestDisplay}. Want me to open *${g.closestName}*?`;
      }
      if (ev.propertyTypeGap) {
        const g = ev.propertyTypeGap;
        const budget = g.budgetDisplay ? ` at ${g.budgetDisplay}` : '';
        const loc = g.location ? ` in *${g.location}*` : '';
        return `No *${g.requestedType}*${budget}${loc} on our books — closest fit is *${g.closestName}* from ${g.closestDisplay}. Want me to open *${g.closestName}*?`;
      }
      if (ev.floor) {
        const lead = ev.floor.projectName ? ` with *${ev.floor.projectName}*` : '';
        const fork = ev.floor.projectName ? ` Want me to open *${ev.floor.projectName}*?` : ' Want the closest options?';
        return `Nothing sits within ${b} — options begin at ${ev.floor.display}${lead}.${fork}`;
      }
      if (ev.noMatch?.reasoning) {
        const emptyChips = ev.searchRecovery?.suggested_actions.length === 0;
        const base = ev.noMatch.reasoning.endsWith('.')
          ? ev.noMatch.reasoning
          : `${ev.noMatch.reasoning}.`;
        // An allotted book has nine projects, not a market — so "no match" is
        // never the end of the sentence. Say what the book actually spans, and
        // the buyer can see for themselves which of their filters has to give.
        if (context.waProjectFirst && ev.catalog?.priceMinInr && ev.catalog.priceMaxInr) {
          const band = `${formatInr(ev.catalog.priceMinInr)} to ${formatInr(ev.catalog.priceMaxInr)}`;
          const count = ev.catalog.total ?? 0;
          const book = count
            ? `All ${count} projects on the book run ${band}`
            : `The book runs ${band}`;
          return `${base} ${book} — here they are, so you can see which part of the brief to loosen.${carriedAsks(context.buyerText)}`;
        }
        // `.` twice: the reasoning already ends in a full stop, and the suffix
        // opened with another one.
        const suffix = emptyChips
          ? ' Tell me what to change — budget, area, or property type.'
          : ' Want to adjust budget, area, or property type?';
        const served =
          ev.catalog?.servedCities?.length
            ? ` We currently serve ${ev.catalog.servedCities.slice(0, 4).join(', ')}.`
            : '';
        return `${base}${served}${suffix}`;
      }
      return `I don't have an exact match right now. Want to adjust budget or area?`;
    }
    case 'objection': {
      const o = ev.objection;
      const angle = o?.reframeAngles[0];
      const ack = o?.acknowledged
        ? o.acknowledged.replace(/\.$/, '')
        : voicePick(seed, [
            'Yeah, pricing is the first thing people push on',
            'Fair — it does sit on the higher side for some buyers',
            'Got it — budget stretch is real',
          ]);
      const mid = angle
        ? ` ${angle}`
        : ' I can show a lower band in the same corridor, or walk the all-in numbers on this one.';
      return `${ack}.${mid} Want cheaper options, a full cost breakup, or a site visit?`;
    }
    case 'emi_calculate':
      return ev.emi
        ? `${emiSnapshotLine(ev.emi)}. Want me to try another loan amount, rate, or tenure?`
        : 'I need a loan amount before I can calculate the EMI.';
    case 'answer': {
      const topics = goal.topics?.length ? goal.topics : [goal.topic];
      const unmet = new Set(ev.notices?.map((failure) => failure.subject) ?? []);
      const suppressPrice =
        unmet.has('carpet_area') || unmet.has('built_up_area');

      if (ev.education || topics.includes('education')) {
        if (ev.education) return speakEducation(ev.education);
        return "I don't have a short explainer for that yet — ask me about property types, buying steps, or buyer documents, or name a project.";
      }


      // Over-answer fix — a primary "tell me about X" gets the compact card,
      // never the chunk assembly (and never FAQ text): sizes, one price band,
      // location, possession, one probing question. Facet asks fall through.
      // ANY faqMiss (taught or text-bound) skips the card — miss is a value,
      // never a license to reset to overview (FAQ-03 payment-plan phone-tree).
      // Advisory atoms (yield / appreciation) must not be swallowed by the card.
      const advisoryRequired =
        goal.requires?.some(
          (k) =>
            k === 'rental_yield' ||
            k === 'appreciation' ||
            k === 'growth_drivers' ||
            k === 'operator_model' ||
            k === 'visit_logistics',
        ) ?? false;
      // A rate ask is answered with the rate. It used to fall through to the
      // price chunks and come back as the headline number, which is the one
      // answer the buyer explicitly did not want.
      if (goal.requires?.includes('price_per_sqft') && ev.perSqft?.rows.length) {
        const pname =
          ev.perSqft.projectName ||
          ev.detail?.name ||
          ev.pricing?.projectName ||
          context.focusProjectName ||
          '';
        const line = pname ? perSqftLine(ev.perSqft, pname) : '';
        if (line) {
          return `${line}${closingCta({
            buyerText: context.buyerText,
            topics: ['price'],
            projectName: pname,
          })}`;
        }
      }
      // Possession / loan facet asks must never be swallowed by the overview card
      // (configs + price first) — answer the asked atom, then optional follow-ups.
      if (isPossessionAsk(context.buyerText) && ev.detail?.possession && !ev.detail.faqs?.length) {
        const pname = ev.detail.name || context.focusProjectName || 'this project';
        return `Possession at *${pname}* is ${formatPossession(ev.detail.possession)}.${closingCta({
          buyerText: context.buyerText,
          topics: ['availability'],
          projectName: pname,
        })}`;
      }
      // A file that GOT SENT is not a miss. `floor_plan` and `payment_plan` are
      // FAQ question keys as well as document kinds, so on a project with no FAQ
      // rows the honest-miss below fired for the very PDF this turn had already
      // attached: "I don't have that detail on file" shipped WITH the floor plan
      // (Eldorado, verified on dev). Master plan read correctly only because it
      // happens not to be an FAQ key. Drop the keys the share answered; whatever
      // it did not answer still honest-misses, so a "floor plan and possession"
      // ask keeps its miss on possession.
      const sharedAssetKind =
        ev.media?.allowed && ev.media.cdnUrl
          ? (normalizeMediaAssetKind(ev.media.assetKind) ?? ev.media.assetKind)
          : undefined;
      const faqMissKeys = (ev.faqMiss?.keys ?? []).filter(
        (k) => !sharedAssetKind || (normalizeMediaAssetKind(k) ?? k) !== sharedAssetKind,
      );
      // FAQ miss with structured rescue — before overview card or chunk assembly.
      if (faqMissKeys.length && !ev.detail?.faqs?.length) {
        const pname =
          ev.detail?.name || context.focusProjectName || 'this project';
        if (faqMissKeys.includes('possession') && ev.detail?.possession) {
          return `Possession at *${pname}* is ${formatPossession(ev.detail.possession)}.${closingCta({
            buyerText: context.buyerText,
            topics: ['availability'],
            projectName: pname,
          })}`;
        }
        if (
          faqMissKeys.some((k) => /^(?:banks|loan_eligibility|loan)$/i.test(k)) &&
          ev.detail?.loanEligibility
        ) {
          return `For *${pname}*, home loan: ${ev.detail.loanEligibility}.${closingCta({
            buyerText: context.buyerText,
            topics: ['legal'],
            projectName: pname,
          })}`;
        }
        // RERA/khata live on ProjectDetail atoms — FAQ miss must not honest-miss
        // when Desk already carries the registration number (Meadows dig).
        if (
          faqMissKeys.some((k) =>
            /^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i.test(k),
          ) &&
          (ev.detail?.reraNumber?.trim() || ev.detail?.khata?.trim())
        ) {
          const snap = legalTitleSnapshot(ev.detail, []);
          return `${snap}.${closingCta({
            buyerText: context.buyerText,
            topics: ['legal'],
            projectName: pname,
          })}`;
        }
        // A category error is not a data gap. Brigade Eldorado is an APARTMENT
        // project; asked "what plot sizes do you have" it reported an empty
        // field — "I don't have that detail on file for *Brigade Eldorado*
        // yet" — when the truth is that plots are the wrong noun for it. The
        // field is not missing; the question does not apply.
        const catMiss = categoryMismatchLine(
          {
            projectType: ev.detail?.projectType,
            category: askedInventoryCategory(context.buyerText),
          },
          ev.units ?? [],
          pname,
        );
        if (catMiss) {
          return `${catMiss}.${closingCta({
            buyerText: context.buyerText,
            topics,
            projectName: pname,
          })}`;
        }
        return `I don't have that detail on file for *${pname}* yet.${closingCta({
          buyerText: context.buyerText,
          topics,
          projectName: pname,
        })}`;
      }
      if (
        topics[0] === 'overview' &&
        ev.detail &&
        // An unrecognised ask lands on 'overview' because the router had nothing
        // else to give it — reciting the card here is what made every unknown
        // question receive a byte-identical project brief.
        !goal.unrecognised &&
        !ev.detail.faqs?.length &&
        !ev.faqMiss?.keys.length &&
        !advisoryRequired &&
        !isPossessionAsk(context.buyerText) &&
        !isLoanEligibilityAsk(context.buyerText)
      ) {
        return overviewCard(ev.detail, {
          ...(context.priorReplyExcerpt ? { priorReply: context.priorReplyExcerpt } : {}),
          // Same base as the default seed, plus the turn's own text — so the
          // card is stable for a given turn and moves between turns.
          seed: `${ev.detail.name}${ev.detail.microMarket ?? ''}${context.buyerText ?? ''}`,
        });
      }

      const chunks: string[] = [];
      // Phase 0b / dialogue-state — multi-intent join: one subject lead, facet
      // atoms without re-stamping the project name on every line.
      const multiTopic = topics.length > 1;

      if (ev.detail) {
        for (const line of advisoryFactLines(ev.detail, goal.requires, context.buyerText ?? '')) {
          chunks.push(line);
        }
      }

      if (topics.includes('amenities') && ev.detail?.amenities?.length) {
        chunks.push(`Amenities on file: ${ev.detail.amenities.slice(0, 8).join(', ')}`);
      }

      if (topics.includes('price') && ev.pricing && !suppressPrice) {
        const p = ev.pricing;
        const lead = priceLeadForAsk(
          p,
          context.buyerText ?? '',
          context.constraints,
          ev.detail,
        );
        const start = formatStartingPrice(p.startingDisplay);
        const header = priceAnswerHeader(
          p.projectName,
          isCostComponentAsk(context.buyerText ?? '') ? p.components : [],
          start,
        );
        chunks.push(multiTopic ? lead : `*${header}:* ${lead}`);
      }
      if (topics.includes('price') && ev.landedCost && !suppressPrice) {
        chunks.push(landedCostLine(ev.landedCost, { omitProjectName: multiTopic }));
      }
      if (topics.includes('property_type') && ev.detail?.projectType) {
        chunks.push(
          multiTopic
            ? `a *${humanizeProjectType(ev.detail.projectType)}* in ${ev.detail.microMarket || 'this market'}`
            : projectTypeLine(ev.detail),
        );
      }
      // AB-8 — media must join the multi-topic chunk path. Primary topic is often
      // price (TOPIC_ORDER), so the single-topic `goal.topic === 'media'` branch
      // never runs for "brochure and starting price" even when mediaShare succeeded.
      // Explicit media topic, or multi-topic availability that co-fetched unit media.
      // Do NOT push media into chunks on single-topic availability — that short-circuits
      // the richer units handler below (CAT-10 regression: media-only reply).
      if (
        ev.media &&
        (topics.includes('media') || (multiTopic && topics.includes('availability')))
      ) {
        chunks.push(mediaShareLine(ev.media, context.focusProjectName, { omitProjectName: multiTopic }));
      }
      // AB-8 — in a MULTI-topic ask the FAQ body carries the OTHER atom(s), so the
      // legal snapshot (RERA/khata) must still render rather than be swallowed by a
      // non-legal FAQ. "RERA and possession" was dropping RERA because a possession
      // FAQ was present. Single-topic behaviour is unchanged.
      const faqPresent = !!ev.detail?.faqs?.length;
      // AB-8b — render the legal SNAPSHOT (RERA/khata) when no FAQ owns it, OR it's
      // a multi-topic ask, OR the buyer named a snapshot atom (RERA/khata/EC) that
      // the present FAQ does not answer. The last case rescues "is it RERA approved
      // AND can I get a loan?": both cues collapse to the single 'legal' topic, so
      // without it the loan FAQ rendered alone and the RERA atom was silently dropped.
      const snapshotAtomAsked =
        topics.includes('legal') &&
        !!ev.detail &&
        asksLegalSnapshotAtom(context.buyerText, ev.detail!.faqs ?? []);
      // Loan asks own the legal topic — FAQ / loanEligibility lead; do not open
      // with a khata/RERA snapshot that answers the wrong abstraction.
      const loanAsk = isLoanEligibilityAsk(context.buyerText);
      const legalSnapshotRendered =
        topics.includes('legal') &&
        !!ev.detail &&
        (!faqPresent || multiTopic || snapshotAtomAsked) &&
        !(loanAsk && !snapshotAtomAsked);
      if (legalSnapshotRendered) {
        // When the buyer named a TITLE atom (RERA/khata/EC) and a separate FAQ carries
        // the other legal atom (loan), render the title snapshot ONLY — focusedLegalLine
        // would pick the loan facet and drop RERA. Snapshot=RERA/khata, FAQ body=loan,
        // so both survive. Otherwise keep the facet-routed line (EC/banks/loan / full).
        const legalLine = snapshotAtomAsked
          ? legalTitleSnapshot(ev.detail!, ev.detail!.faqs ?? [])
          : focusedLegalLine(ev.detail!, context.buyerText, context.disclosedFacts);
        const legalAtom = multiTopic ? stripProjectNameLead(legalLine) : legalLine;
        // Multi-topic + FAQ already owns the legal atom — skip empty "on file" filler.
        const emptyLegalFiller =
          multiTopic &&
          faqPresent &&
          /^legal details on file with our team\.?$/i.test(legalAtom);
        if (!emptyLegalFiller) chunks.push(legalAtom);
      }
      if (topics.includes('location') && ev.location) {
        chunks.push(locationSnapshotLine(ev.location, { omitProjectName: multiTopic }));
      }
      // AB-8b — structural atoms (configs / EMI) must render as their OWN chunk when
      // a FAQ would shadow them, OR when multi-topic already owns the reply (media +
      // availability). Without this, "2BHK configs" that also co-fetches a unit image
      // collapsed to media-only because multi-topic returns before single-topic handlers.
      // A possession question is answered by the timeline, not by the config card.
      // "is it ready to move in?" returned "Yes — 5 sizes on file (…). RERA-committed
      // possession is March 2027" — a config list, a verdict word, and then the fact
      // that contradicts it, in one message. The single-topic path has guarded this
      // for a while; this chunked path never did, so the guard only ran when NO FAQ
      // was present. That is why a genuinely-ready project answered correctly and a
      // 2027 one did not: they differed by a FAQ row, not by the question.
      // There is no `configurations` FAQ key to test against — "what
      // configurations deliver by possession?" resolves to ['possession'] alone —
      // so this suppresses the list for a combined ask too. That is the same
      // trade the single-topic guard already makes, and the closer it hands back
      // is exactly the offer: "Want the configurations that deliver in that
      // window, or pricing next?"
      if (
        topics.includes('availability') &&
        ev.units?.length &&
        (faqPresent || multiTopic) &&
        !isPossessionAsk(context.buyerText)
      ) {
        chunks.push(
          summarizeUnitConfigs(ev.units, multiTopic ? undefined : context.focusProjectName, {
            ...askedConfigFamily(context.buyerText, context.constraints),
            projectType: ev.detail?.projectType,
            category: askedInventoryCategory(context.buyerText),
          }),
        );
      }
      if (faqPresent && topics.includes('emi') && ev.emi) {
        chunks.push(emiSnapshotLine(ev.emi));
      }
      // Desk FAQ (loan eligibility, yield, …) beats EMI snapshot when both present.
      if (ev.detail?.faqs?.length) {
        // Drop only the FAQs the legal snapshot ALWAYS owns — RERA / khata /
        // rera_number — and only when that snapshot actually rendered. Keep loan/EMI
        // and everything else so a "RERA and home loan" ask keeps its loan atom.
        const relevant = legalSnapshotRendered
          ? ev.detail.faqs.filter((f) => !/^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i.test(f.questionKey))
          : ev.detail.faqs;
        // Distinct FAQ KEYS routinely carry identical prose (banks and
        // loan_eligibility are usually the same sentence), and joining them
        // blind printed that sentence twice in every EMI answer.
        const seenAnswers = new Set<string>();
        const body = relevant
          .map((f) => f.answer.trim())
          .filter((a) => {
            if (!a) return false;
            const key = a.toLowerCase().replace(/\s+/g, ' ');
            if (seenAnswers.has(key)) return false;
            seenAnswers.add(key);
            return true;
          })
          .join(' ');
        if (body) chunks.push(body);
      } else if (topics.includes('emi') && ev.emi) {
        chunks.push(emiSnapshotLine(ev.emi));
      }
      const park = parkContinuation(goal.parkedTopics);
      const subjectName =
        context.focusProjectName ||
        ev.detail?.name ||
        ev.pricing?.projectName ||
        ev.landedCost?.projectName ||
        'this project';
      const cta = (extra?: { projectName?: string }) =>
        closingCta({
          buyerText: context.buyerText,
          topics,
          projectName: extra?.projectName ?? subjectName,
          park,
          ...(context.priorReplyExcerpt ? { priorReply: context.priorReplyExcerpt } : {}),
          ...(ev.detail?.projectType ? { projectType: ev.detail.projectType } : {}),
          ...(ev.landedCost ? { allInDelivered: true } : {}),
        });
      if (multiTopic && chunks.length >= 1) {
        const body = chunks
          .map((c) => c.replace(/[.。]\s*$/, '').trim())
          .filter(Boolean)
          .join('; ');
        return `On *${subjectName}*: ${body}.${cta()}`;
      }
      if (chunks.length > 1) {
        return `${chunks.join('\n\n')}.${cta()}`;
      }
      if (chunks.length === 1) {
        return `${chunks[0]}.${cta()}`;
      }

      if (goal.topic === 'price' && ev.landedCost && !suppressPrice) {
        return `${landedCostLine(ev.landedCost)}.${cta({ projectName: ev.landedCost.projectName })}`;
      }
      if (goal.topic === 'price' && ev.pricing && !suppressPrice) {
        const p = ev.pricing;
        const lead = priceLeadForAsk(
          p,
          context.buyerText ?? '',
          context.constraints,
          ev.detail,
        );
        return `For *${p.projectName}*: ${lead}.${cta({ projectName: p.projectName })}`;
      }
      if (goal.topic === 'property_type' && ev.detail?.projectType) {
        return `${projectTypeLine(ev.detail)} Want pricing, plot sizes, or a visit?`;
      }
      if (goal.topic === 'compare' && ev.compare?.tableText.trim()) {
        // Answer the question that was asked, not "here is everything".
        //
        // Six different comparison questions in one live run — which is bigger,
        // which is closer to the airport, which is ready first, compare the 2
        // BHK, maintenance in both, better clubhouse — came back as the same
        // eight-row card, three times identically. The matrix has been carrying
        // keyed rows the whole time and nothing read them.
        const led = compareFacetLead(context.buyerText ?? '', ev.compare);
        if (led) return led;
        const advice = compareAdviceLine(context.buyerText ?? '', ev.compare.projects);
        return advice ? `${advice}\n\n${ev.compare.tableText.trim()}` : ev.compare.tableText.trim();
      }
      if (goal.topic === 'legal' && ev.detail) {
        // Loan asks must lead with loan — never open on khata/RERA snapshot.
        if (isLoanEligibilityAsk(context.buyerText)) {
          const loanFaq = (ev.detail.faqs ?? []).filter((f) =>
            /^(?:banks|loan_eligibility|loan)$/i.test(f.questionKey),
          );
          const loanBody = loanFaq
            .map((f) => f.answer.trim())
            .filter(Boolean)
            .join(' ');
          const lead = loanBody
            ? loanBody
            : ev.detail.loanEligibility
              ? `Yes. Major banks finance this project — ${ev.detail.loanEligibility}`
              : '';
          if (lead) {
            const approvalHint = ev.detail.khata
              ? ` Approvals on file include ${ev.detail.khata}.`
              : '';
            return `${lead}${approvalHint}.${cta({ projectName: ev.detail.name })}`;
          }
        }
        return `${focusedLegalLine(ev.detail, context.buyerText, context.disclosedFacts)}.${cta({ projectName: ev.detail.name })}`;
      }
      if (goal.topic === 'location' && ev.location) {
        return `${locationSnapshotLine(ev.location)}.${cta()}`;
      }
      if (goal.topic === 'media' && ev.media) {
        return mediaShareLine(ev.media, context.focusProjectName);
      }
      // Closed-beta: Desk FAQ (loan eligibility, yield, …) before EMI snapshot.
      if (ev.detail?.faqs?.length) {
        const pname = ev.detail.name || context.focusProjectName || 'this project';
        const body = ev.detail.faqs
          .map((f) => f.answer.trim())
          .filter(Boolean)
          .join(' ');
        if (body) {
          return `${body}.${cta({ projectName: pname })}`;
        }
      }
      if (goal.topic === 'emi' && ev.emi) {
        return `${emiSnapshotLine(ev.emi)}.${cta()}`;
      }
      if (goal.topic === 'availability' && ev.units?.length) {
        const pname = ev.detail?.name ?? context.focusProjectName;
        // What the buyer asked for, so the summary can answer no. Without it the
        // config copy opens "Yes —" whatever the book holds.
        const askedCfg: AskedConfig = {
          ...askedConfigFamily(context.buyerText, context.constraints),
          projectType: ev.detail?.projectType,
          category: askedInventoryCategory(context.buyerText),
        };
        // AB-1 — an inventory ask ("is there any inventory left?") wants the
        // availability FACT. A config card list without it is a non-answer.
        let facts: string;
        if (isInventoryAsk(context.buyerText ?? '')) {
          const tracked = ev.units.filter((u) => (u.holdableUnits ?? 0) > 0);
          if (tracked.length) {
            const lines = tracked
              .slice(0, 4)
              .map((u) => `${u.holdableUnits} × ${u.unitType}`)
              .join(', ');
            facts = `Yes — still open${pname ? ` at *${pname}*` : ''}: ${lines}.`;
          } else {
            // All-zero counts can mean "not tracked" as much as "sold out" — Desk
            // sends 0 for every config when a project has no unit rows at all.
            // Never claim sold out without positive evidence; route the exact
            // count to the team instead.
            facts = `${summarizeUnitConfigs(ev.units, pname, askedCfg)} Exact unit-level counts are confirmed by our team.`;
          }
        } else {
          facts = `${summarizeUnitConfigs(ev.units, pname, askedCfg)}.`;
        }
        // Unit-typed site image / floor plan co-fetched with BHK-scoped
        // availability. It is its OWN sentence and it goes before the question —
        // appended after the closer it read as a lowercase run-on
        // ("…check live unit availability? here's the site photos").
        if (ev.media?.allowed && ev.media.cdnUrl) {
          const bit = mediaShareLine(ev.media, context.focusProjectName, {
            omitProjectName: true,
          }).trim();
          facts = `${facts.replace(/\s*$/, '')} ${bit.charAt(0).toUpperCase()}${bit.slice(1)}.`;
        }
        return `${facts}${cta({ projectName: pname })}`;
      }
      // SA-3: availability with empty units — honest empty, not generic overview.
      if (goal.topic === 'availability') {
        const pname = ev.detail?.name ?? context.focusProjectName ?? 'this project';
        return `Configuration details for *${pname}* aren't published yet — I can share pricing or book a visit to see options on site.`;
      }
      // Possession ask — answer possession first; never dump the overview card
      // (configs + price) ahead of the timeline the buyer asked for.
      if (isPossessionAsk(context.buyerText) && ev.detail?.possession) {
        const pname = ev.detail.name || context.focusProjectName || 'this project';
        const pos = formatPossession(ev.detail.possession);
        return `Possession at *${pname}* is ${pos}.${cta({ projectName: pname })}`;
      }
      if (ev.faqMiss?.keys.length) {
        const pname = context.focusProjectName || 'this project';
        if (ev.faqMiss.keys.includes('possession') && ev.detail?.possession) {
          const pos = formatPossession(ev.detail.possession);
          return `Possession at *${pname}* is ${pos}.${cta({ projectName: pname })}`;
        }
        // A category error is not a data gap. Brigade Eldorado is an APARTMENT
        // project; asked "what plot sizes do you have" it reported an empty
        // field — "I don't have that detail on file for *Brigade Eldorado*
        // yet" — when the truth is that plots are the wrong noun for it. The
        // field is not missing; the question does not apply.
        const catMiss = categoryMismatchLine(
          {
            projectType: ev.detail?.projectType,
            category: askedInventoryCategory(context.buyerText),
          },
          ev.units ?? [],
          pname,
        );
        if (catMiss) return `${catMiss}.${cta({ projectName: pname })}`;
        return `I don't have that detail on file for *${pname}* yet.${cta({ projectName: pname })}`;
      }
      if (ev.detail) {
        // Everything that COULD answer has now declined to. If the buyer asked
        // something specific and `overview` was only where the router landed,
        // the card is not an answer — and reciting the identical card for every
        // unrecognised question is exactly how the bot reads as not listening.
        if (goal.unrecognised) {
          const pname = ev.detail.name || context.focusProjectName || 'this project';
          // "2027 is too late for me", "I need to check with my wife", "I don't
          // want a high rise" are STATEMENTS. Answering them with "I don't have
          // that on file" claims a lookup for a fact nobody asked for — a
          // category error, and the buyer hears a bot that didn't read the
          // sentence. Only a question earns the file answer; a statement gets
          // acknowledged, and gets the one lever this line actually has.
          // A statement can still name a fact we hold. "1400 sqft for a 3 bhk is
          // too small" reads as an objection, but the sizes are on file and the
          // useful reply is the bigger configuration — not a note passed to the
          // team. Fact-bearing statements fall through to the answer path;
          // "2027 is too late", "I need to check with my wife" do not, because
          // there is no fact in them to look up.
          const namesAMeasurement =
            /\b(?:sq\.?\s*ft|sqft|sft|square\s*(?:feet|foot)|carpet|built[- ]?up)\b/i.test(
              context.buyerText ?? '',
            );
          if (!goal.requires?.length && !namesAMeasurement && !looksLikeAQuestion(context.buyerText)) {
            const said = `Understood — I've noted that and it goes to the *${pname}* team with your own words.`;
            const lever = ` If it changes what you're after, tell me a size or a budget and I'll re-cut the book — or say "projects" to see everything, "call me" and someone will reach you.`;
            if (!repeatsPrior(said, context.priorReplyExcerpt)) return `${said}${lever}`;
          }
          const miss = `I don't have that on file for *${pname}* — I'd rather have our team confirm it than guess, so I'm passing it on. Meanwhile I can give you pricing, the configurations, the legal picture, or set up a site visit.`;
          // Two misses in a row means the menu isn't what they want. Saying the
          // same sentence again reads as a wall; name the gap and hand them a
          // person instead.
          if (!repeatsPrior(miss, context.priorReplyExcerpt)) return miss;
          return `That's a second one I can't answer from the file for *${pname}*, so I've flagged both for our team to come back on. If it's easier, say "call me" and someone will reach you — or tell me a date and I'll set up a site visit.`;
        }
        // Overview fallthrough — the founder-spec card: sizes, one price
        // band (from configs), location, possession, one probing question.
        return overviewCard(ev.detail, {
          ...(context.priorReplyExcerpt ? { priorReply: context.priorReplyExcerpt } : {}),
          // Same base as the default seed, plus the turn's own text — so the
          // card is stable for a given turn and moves between turns.
          seed: `${ev.detail.name}${ev.detail.microMarket ?? ''}${context.buyerText ?? ''}`,
        });
      }
      return `Let me get that confirmed and follow up shortly.`;
    }
    case 'commit':
      if (context.waProjectFirst) {
        // The pick opens the project's own sizes. Naming them is the whole
        // point of the sub-option step — a buyer who taps a project has
        // chosen WHERE and is now choosing WHAT, and every later answer
        // (price, availability, EMI) is sharper once the size is known. The
        // jobs stay on the same list, so the size is an option, not a toll.
        const sizes = context.waSizeOptions ?? 0;
        if (sizes >= 2) {
          // Only claim a count when every one of them is on screen — the list
          // caps at 7 rows, and "7 sizes" over 6 rows is a promise we broke.
          const head = sizes <= 7 ? `${sizes} sizes on file` : 'these are the sizes on file';
          return (
            `*${goal.projectName}* — ${head}. ` +
            `Pick the one you're after and I'll price it, or go straight to the full price list or a visit.`
          );
        }
        return `*${goal.projectName}* — Price, a visit, or ask me anything.`;
      }
      return `Great choice${name} — let's look at *${goal.projectName}*. Want pricing, legal status, or to line up a visit?`;
    case 'propose_visit':
      return context.channel === 'advisor_web'
        ? `I can help plan a site visit — which day works best for you?`
        : `Happy to set up a visit. Which day works for you?`;
    case 'visit_ask':
    case 'visit_propose':
      return goal.copy;
    case 'visit_booked':
      return `Done — your visit to *${goal.projectName}* is set for ${goal.label}. Our team will confirm details before the day.`;
    case 'hold_propose':
      return goal.copy;
    case 'hold_booked':
      // W7 — three honest outcomes: held, queued (waitlist confirmed), or gone.
      if (goal.queued) {
        return `Done — you're ${goal.position && goal.position > 1 ? `#${goal.position} in line` : 'first in line'} for the next *${goal.unitType}* at *${goal.projectName}*. The moment one frees up it's auto-held for you and our team will call.`;
      }
      return goal.placed
        ? `Done — a *${goal.unitType}* at *${goal.projectName}* is held for you${goal.expiresLabel ? ` until ${goal.expiresLabel}` : ' for the next 24 hours'}. Our team will reach out to take it forward.`
        : `I'm sorry — the last *${goal.unitType}* at *${goal.projectName}* was just taken. Want me to check another configuration, or have our team call you about the waitlist?`;
    case 'visit_recall': {
      const vs = ev.visits?.visits ?? [];
      if (!vs.length) {
        return ev.visits?.siteVisitHours
          ? `I don't see a confirmed visit yet. Site visits are ${ev.visits.siteVisitHours} — want to book one?`
          : "I don't see a confirmed visit on file yet — want to set one up?";
      }
      const list = vs.map((v) => `*${v.projectName}* — ${v.label}${v.confirmed ? '' : ' (pending)'}`).join('; ');
      return `Your visits: ${list}. Our team will confirm details before the day.`;
    }
    case 'recall_constraints': {
      const c = context.constraints;
      const bits = [
        c.location && `area *${c.location}*`,
        c.budgetMaxInr && `budget ~${formatInr(c.budgetMaxInr)}`,
        c.bhk && `*${c.bhk}*`,
        c.purpose && `purpose ${c.purpose}`,
      ].filter(Boolean);
      if (!bits.length) {
        return context.channel === 'advisor_web'
          ? "I don't have a brief on file yet — set area, budget, or size in preferences (or tell me here)."
          : "I don't have your brief on file yet — share area, budget, or BHK and I'll lock it in.";
      }
      return context.channel === 'advisor_web'
        ? `Your brief so far: ${bits.join(', ')}. It's on the board side — change a chip anytime, or ask me to refine.`
        : `Your brief so far: ${bits.join(', ')}. Want me to show matches again, or open one by name?`;
    }
    case 'handoff': {
      const phone = context.handoffPhone?.trim();
      const who = context.handoffTeamName?.trim() || 'our sales team';
      if (phone) {
        return `I'll connect you with ${who} on this — you can also reach them at ${phone}. They'll take it from here.`;
      }
      return `I'll connect you with ${who} on this — they'll take it from here with your chat context.`;
    }
    case 'warm_ack': {
      const name = context.buyerName ? `, ${context.buyerName}` : '';
      if (context.focusProjectName) {
        return `You're all set${name}! If anything else comes up on *${context.focusProjectName}* — pricing, legal, or another visit — just ask.`;
      }
      return `You're all set${name}! If anything else comes up — pricing, legal, or a visit — just ask.`;
    }
    case 'smalltalk':
      if (context.waProjectFirst) {
        return waBookFirstGreet({ builderName: context.builderName, catalog: ev.catalog });
      }
      return `Doing well, thanks${name}! What kind of property are you exploring — area, budget, or configuration?`;
    default:
      return `Tell me the area, budget, or a project name and I'll pull live options from our catalog.`;
  }
}

function focusedLegalLine(
  d: import('./types.js').ProjectDetail,
  buyerText?: string,
  disclosedFacts?: ComposeRequest['context']['disclosedFacts'],
): string {
  const t = (buyerText ?? '').toLowerCase();
  if (/\b(?:ec|encumbrance)\b/i.test(t) && d.ecStatus) {
    return `For *${d.name}*, EC: ${d.ecStatus}`;
  }
  // banks / approved / loan — plurals and stems (not bare \bbank\b)
  if (/\b(?:banks?|loans?|approv\w*|lenders?|financ(?:e|ing))\b/i.test(t) && d.loanEligibility) {
    return `For *${d.name}*, home loan: ${d.loanEligibility}`;
  }
  // Skip repeat RERA only on banks/EC follow-ups — not broad "legal status".
  const facetFollowUp =
    /\b(?:ec|encumbrance|banks?|loans?|approv\w*|lenders?|financ(?:e|ing))\b/i.test(t);
  return legalSnapshotLine(d, true, facetFollowUp && hasDisclosedRera(disclosedFacts, d.projectId));
}

function legalSnapshotLine(
  d: import('./types.js').ProjectDetail,
  includeConfigs = true,
  skipRera = false,
): string {
  const bits: string[] = [];
  if (!skipRera) {
    const phaseReras = (d.phases ?? []).filter((p) => p.reraNumber?.trim());
    if (phaseReras.length > 1) {
      bits.push(
        `RERA by phase: ${phaseReras
          .map((p) => `${p.phaseLabel} ${p.reraNumber}`)
          .join('; ')}`,
      );
    } else if (d.reraNumber) {
      bits.push(`RERA: ${d.reraNumber}`);
    } else if (phaseReras[0]?.reraNumber) {
      bits.push(`RERA: ${phaseReras[0].reraNumber}`);
    }
  }
  if (d.khata) bits.push(`Khata: ${d.khata}`);
  if (d.naStatus) bits.push(`NA: ${d.naStatus}`);
  if (d.ecStatus) bits.push(`EC: ${d.ecStatus}`);
  if (d.possession) bits.push(`Possession: ${d.possession}`);
  if (d.loanEligibility) bits.push(`Loan: ${d.loanEligibility}`);
  if (includeConfigs && d.configurations?.length) {
    const configs = d.configurations
      .slice(0, 4)
      .map((c) => formatUnitConfigLine(c))
      .join('; ');
    bits.push(`Configurations: ${configs}`);
  }
  if (bits.length) return `Regulatory snapshot for *${d.name}*: ${bits.join('. ')}`;
  return `Legal and title details for *${d.name}* are on file with our team`;
}

/**
 * AB-8b — the buyer named a legal SNAPSHOT atom (RERA/khata/title/EC) that the
 * present FAQ does not already answer. True lets compose render the title snapshot
 * alongside the FAQ body so a "is it RERA approved AND can I get a loan?" ask (both
 * cues collapse to the single 'legal' topic) keeps BOTH atoms. Bare "loan approval"
 * has no title cue, so a pure loan ask is unaffected.
 */
function asksLegalSnapshotAtom(
  text: string | undefined,
  faqs: ReadonlyArray<{ questionKey: string; answer?: string }>,
): boolean {
  if (!text) return false;
  // Title-atom cues only — phrase-scoped so a bare "loan approval" can't trip it.
  if (!/\b(?:rera|khata|title|encumbrance|\bec\b|clear\s+title|approval\s+status|plan\s+approval|legal\s+status|legal\s+details?)\b/i.test(text)) return false;
  // A legal-snapshot FAQ owns this atom only if its BODY actually answers it.
  // Brigade's legal_status FAQ is the khata blurb — keyed legal, silent on RERA —
  // so "is it RERA approved?" was answered with A-Khata and the registration
  // number we hold was never spoken. Own the topic ≠ deliver the fact.
  const legalOwned = /^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i;
  const reraAsked = /\brera\b/i.test(text);
  return !faqs.some(
    (f) =>
      legalOwned.test(f.questionKey) &&
      (!reraAsked || RERA_IN_ANSWER.test(f.answer ?? '')),
  );
}

/** A RERA registration as a buyer would recognise it — "PRM/KA/RERA/…", "RERA no …". */
const RERA_IN_ANSWER =
  /(?:\bPRM\/|\brera\s*(?:registration\s*)?(?:no\.?|number|#)?\s*[:\-]?\s*[A-Z0-9][A-Z0-9\/]{6,})/i;

/** RERA/khata/title snapshot only — the other legal atom (loan) comes from the FAQ body. */
function legalTitleSnapshot(
  d: import('./types.js').ProjectDetail,
  faqs: ReadonlyArray<{ questionKey: string }>,
): string {
  const bits: string[] = [];
  const phaseReras = (d.phases ?? []).filter((p) => p.reraNumber?.trim());
  if (phaseReras.length > 1) {
    bits.push(
      `RERA by phase: ${phaseReras.map((p) => `${p.phaseLabel} ${p.reraNumber}`).join('; ')}`,
    );
  } else if (d.reraNumber) {
    bits.push(`RERA: ${d.reraNumber}`);
  } else if (phaseReras[0]?.reraNumber) {
    bits.push(`RERA: ${phaseReras[0].reraNumber}`);
  }
  if (d.khata) bits.push(`Khata: ${d.khata}`);
  if (d.naStatus) bits.push(`NA: ${d.naStatus}`);
  if (d.ecStatus) bits.push(`EC: ${d.ecStatus}`);
  // Loan only when no FAQ will carry it — avoids double-rendering the loan atom.
  const loanFaq = faqs.some((f) => /loan|financ|emi/i.test(f.questionKey));
  if (d.loanEligibility && !loanFaq) bits.push(`Loan: ${d.loanEligibility}`);
  return bits.length
    ? `Regulatory snapshot for *${d.name}*: ${bits.join('. ')}`
    : `Legal and title details for *${d.name}* are on file with our team`;
}

/**
 * AB-8b — config/inventory content for a MULTI-atom ask ("configs and possession"),
 * as a bare chunk (the assembly appends its own follow-up). Mirrors the single-topic
 * availability logic so a co-fetched FAQ can't shadow the configs the buyer asked for.
 */
/**
 * Summary-first config copy — group by BHK family before listing variants.
 * Avoids a flat database dump of every row.
 */
/** "a", "a and b", "a, b and c" — sizes read as prose, not as a slash-list. */
function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

interface UnitConfigRow {
  unitType: string;
  priceDisplay: string;
  sizeDisplay?: string;
  holdableUnits?: number;
}

/** What the buyer asked for on THIS turn — the input to answering yes or no. */
export interface AskedConfig {
  /** Normalised family the buyer named ("5 BHK"), when they named one. */
  family?: string;
  /** The buyer put the question in BHK terms at all ("what BHK options…"). */
  inBhkTerms?: boolean;
  /** Raw catalog project_type — supplies the REASON a BHK ask has no answer. */
  projectType?: string;
  /**
   * The inventory category the buyer named on THIS turn ("plot", "apartment",
   * "villa", "plantation") — the input to noticing they named the wrong one.
   */
  category?: string;
}

/**
 * The inventory category named on this turn, from the buyer's own words.
 *
 * `detectPropertyTypes` is the existing authority for that — the same one the
 * search constraint uses — so this reads it rather than inventing a second
 * vocabulary. Two categories in one breath ("apartments or villas") is a
 * question about the range, not a claim about either, so it yields nothing.
 */
export function askedInventoryCategory(buyerText?: string): string | undefined {
  const t = (buyerText ?? '').trim();
  if (!t) return undefined;
  const found = detectPropertyTypes(t);
  if (!found || found.includes(',')) return undefined;
  return found;
}

/**
 * What this project actually holds — from its type AND its unit rows.
 *
 * The rows are the harder evidence: Ayana is filed as
 * `managed_plantation_estate` and its book lists "5,000 sqft Plot", so it holds
 * plots whichever string you read. Deliberately generous — a "3 BHK Villa" row
 * counts as both — because this set exists to license saying NO, and a no may
 * only be said about a category the book clearly does not contain.
 */
function inventoryCategoriesOf(
  projectType: string | undefined,
  units: ReadonlyArray<UnitConfigRow>,
): Set<string> {
  const out = new Set<string>();
  const t = (projectType ?? '').toLowerCase();
  if (t.includes('plantation') || t.includes('farm')) {
    out.add('plantation');
    out.add('plot');
  }
  if (t.includes('plot')) out.add('plot');
  if (t.includes('villa')) out.add('villa');
  if (t.includes('apartment') || t.includes('flat')) out.add('apartment');
  for (const u of units) {
    const s = (u.unitType ?? '').toLowerCase();
    if (/\bplots?\b|\bacres?\b|\bsites?\b/.test(s)) out.add('plot');
    if (/\bvillas?\b/.test(s)) out.add('villa');
    if (/\bbhk\b|\bstudio\b|\bpenthouse\b/.test(s)) out.add('apartment');
  }
  return out;
}

/** How the buyer would say it back. */
function categoryPlural(category: string): string {
  if (category === 'plantation') return 'plantation estates';
  if (category === 'apartment') return 'apartments';
  if (category === 'villa') return 'villas';
  if (category === 'plot') return 'plots';
  return category;
}

/**
 * The buyer named a category this project does not have — a category error, not
 * a missing field. Returns the correction, or undefined when there is no
 * mismatch to report (or too little known about the project to claim one).
 */
export function categoryMismatchLine(
  asked: AskedConfig | undefined,
  units: ReadonlyArray<UnitConfigRow>,
  projectName?: string,
): string | undefined {
  const category = asked?.category;
  if (!category) return undefined;
  const held = inventoryCategoriesOf(asked?.projectType, units);
  if (!held.size || held.has(category)) return undefined;
  const who = projectName ? `*${projectName}*` : 'This project';
  const kind = humanizeProjectType(asked?.projectType);
  const article = /^[aeiou]/i.test(kind) ? 'an' : 'a';
  return `${who} is ${article} *${kind}* — there are no ${categoryPlural(category)} there`;
}

/**
 * The config family asked for on this turn, from the buyer's own words.
 *
 * `constraints.bhk` is sticky — it survives from the turn that set it, so on its
 * own it would answer a later generic "what's available" with a "No — 5 BHK
 * isn't on file" nobody asked for. The turn's text is therefore the authority
 * for WHETHER a config was asked; the constraint only normalises spelled-out
 * numbers ("five bhk") the text regex cannot.
 */
export function askedConfigFamily(
  buyerText: string | undefined,
  constraints?: { bhk?: string },
): { family?: string; inBhkTerms: boolean } {
  const t = (buyerText ?? '').toLowerCase();
  if (!/\bbhk\b|\bbedrooms?\b|\bbed\s?rooms?\b/.test(t)) return { inBhkTerms: false };
  const fromText = /(\d+)\s*(?:bhk|bed\s?rooms?)/.exec(t)?.[1];
  const fromConstraint = /(\d+)/.exec(constraints?.bhk ?? '')?.[1];
  const n = fromText ?? fromConstraint;
  return { family: n ? `${n} BHK` : undefined, inBhkTerms: true };
}

/** What a project of this type IS listed as, when its book holds no BHK rows. */
function configNounFor(projectType?: string): string | undefined {
  const s = (projectType ?? '').toLowerCase();
  if (!s) return undefined;
  if (s.includes('plot') || s.includes('plantation') || s.includes('farm')) return 'plots';
  if (s.includes('villa')) return 'villas';
  return undefined;
}

export function summarizeUnitConfigs(
  units: ReadonlyArray<UnitConfigRow>,
  projectName?: string,
  asked?: AskedConfig,
): string {
  const lead = projectName ? `For *${projectName}*: ` : '';
  if (!units.length) return `${lead}configurations aren't published yet`;

  type UnitRow = UnitConfigRow;
  const byFamily = new Map<string, UnitRow[]>();
  for (const u of units) {
    const m = /(\d+)\s*bhk/i.exec(u.unitType);
    const family = m ? `${m[1]} BHK` : u.unitType.trim() || 'Unit';
    const list = byFamily.get(family) ?? [];
    list.push(u);
    byFamily.set(family, list);
  }

  const families = [...byFamily.entries()];
  const sizesOf = (rows: UnitRow[]): string =>
    joinWithAnd(rows.map((r) => r.sizeDisplay).filter((s): s is string => !!s).slice(0, 3));
  /** The inventory half, with no verdict word in front of it. */
  const onFile = (): string =>
    families
      .slice(0, 4)
      .map(([family, rows]) => {
        const sizes = sizesOf(rows);
        if (rows.length === 1) {
          return sizes ? `${family} — ${sizes}` : formatUnitConfigLine(rows[0]!);
        }
        return `${family} — ${rows.length} layouts${sizes ? `, ${sizes}` : ''}`;
      })
      .join('. ');

  // Ayana is a managed plantation estate. Asked "is 5 BHK available there?" every
  // branch below used to open "Yes —" and then list plots: every token a real
  // catalog fact, so grounding passed, and the answer was still untrue. A reply
  // may only claim a fit it can point at — so the two ways the ask has no fit are
  // answered BEFORE any of them (founder, 16 Aug).
  // The wrong NOUN for this project, which the summary used to answer with the
  // right noun and a verdict word in front: Brigade Cornerstone, an apartment
  // project, answered "what is the plot area" with "Yes — 4 sizes on file
  // (1 BHK, 2 BHK, 3 BHK, Studio)", and Ayana answered "what apartments are
  // available" with "Yes — 3 sizes on file (5,000 sqft Plot …)". Both true
  // rows, neither an answer. First, name the category (founder, 16 Aug: treat
  // it as a recognition problem).
  const mismatch = categoryMismatchLine(asked, units, projectName);
  if (mismatch) return `${mismatch}. On file: ${onFile()}`;

  const bhkFamilies = families.filter(([f]) => /^\d+ BHK$/.test(f));
  if (asked?.inBhkTerms && !bhkFamilies.length) {
    const who = projectName ? `*${projectName}*` : 'This project';
    const noun = configNounFor(asked.projectType);
    const because = noun
      ? `is a *${humanizeProjectType(asked.projectType)}* — its inventory is listed as ${noun}, not BHK`
      : `isn't listed by BHK`;
    return `${who} ${because}. On file: ${onFile()}`;
  }
  if (asked?.family && !byFamily.has(asked.family)) {
    return `No — *${asked.family}* isn't on file${projectName ? ` at *${projectName}*` : ''}. What is: ${onFile()}. Exact availability depends on live inventory`;
  }

  if (families.length === 1 && families[0]![1].length === 1) {
    const u = families[0]![1][0]!;
    return `${lead}${formatUnitConfigLine(u)}`;
  }

  // "2 2 BHK variants on file. 2 BHK: 2 variants ranges from …" — the head and
  // the line said the same thing twice, and the count collided with the size
  // name. One family gets ONE sentence; the sizes are the useful half.
  if (families.length === 1) {
    const [family, rows] = families[0]!;
    const sizes = sizesOf(rows);
    const layouts = `${rows.length} layout${rows.length > 1 ? 's' : ''}`;
    return sizes
      ? `${lead}Yes — *${family}* is on file, in ${layouts}: ${sizes}. Exact availability depends on live inventory`
      : `${lead}Yes — *${family}* is on file, in ${layouts}. Exact availability depends on live inventory`;
  }

  const head = `Yes — ${families.length} sizes on file (${families.map(([f]) => f).join(', ')})`;
  const lines = families.slice(0, 4).map(([family, rows]) => {
    const sizes = sizesOf(rows);
    if (rows.length === 1) {
      return `${family}${sizes ? ` — ${sizes}` : ` — ${formatUnitConfigLine(rows[0]!).replace(rows[0]!.unitType, '').trim()}`}`;
    }
    return `${family} — ${rows.length} layouts${sizes ? `, ${sizes}` : ''}`;
  });

  return `${lead}${head}. ${lines.join('. ')}. Exact availability depends on live inventory`;
}

function projectTypeLine(d: import('./types.js').ProjectDetail): string {
  return `*${d.name}* is a *${humanizeProjectType(d.projectType)}* project in ${d.microMarket}.`;
}

function humanizeProjectType(raw?: string): string {
  if (!raw) return 'residential';
  const s = raw.toLowerCase();
  if (s.includes('plot')) return 'plotted development';
  if (s.includes('plantation')) return 'managed plantation estate';
  if (s.includes('villa')) return 'villa project';
  if (s.includes('apartment')) return 'apartment project';
  return raw.replace(/_/g, ' ');
}

// Label words that carry no identity — every cost row has "charges"/"fee".
const COMPONENT_LABEL_NOISE = new Set([
  'charges', 'charge', 'fees', 'fee', 'cost', 'costs', 'price', 'amount', 'mandatory',
  'one', 'time', 'onetime', 'total', 'slot', 'per', 'with', 'and',
]);

/**
 * AB-1 — a cost-component ask gets THE component, not the whole card. "club
 * membership fee?" was answered with base price + parking + club + GST; the fact
 * asked for is one line of that. Matches buyer text against component labels by
 * significant token ("club", "parking", "stamp", "gst"); no match → [] and the
 * caller keeps the full card.
 */
export function componentsForAsk<T extends { label: string }>(
  text: string,
  components: readonly T[],
): T[] {
  const t = ` ${text.toLowerCase()} `;
  if (!t.trim()) return [];
  return components.filter((c) => {
    const tokens = c.label
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^a-z]+/)
      .filter((w) => (w.length >= 4 || w === 'gst' || w === 'plc') && !COMPONENT_LABEL_NOISE.has(w));
    return tokens.some((w) => new RegExp(`\\b${w}`, 'i').test(text));
  });
}

/**
 * AB-7 — generic property-TYPE taxonomy for a knowledge ask ("apartment or plot —
 * what's the difference?"). Universal real-estate knowledge (the LLD's sanctioned
 * template), NOT project- or place-specific data — never quotes a project or price.
 */
const TYPE_TAXONOMY: Record<string, string> = {
  apartment: 'an *apartment* is a home within a shared multi-storey building — you own the unit plus an undivided share of the land, with ready common amenities and a lower entry price',
  plot: 'a *plot* is a parcel of land in a gated layout — you own the land outright and build your own home when you choose; land value tends to track the area',
  villa: 'a *villa* is an independent house on its own land in a community — the space and privacy of land with a ready-built home',
  plantation: 'a *managed plantation estate* is titled farm land (coffee/pepper) with an operator running the estate on your behalf — a lifestyle asset that can earn crop revenue',
};

export function typeComparisonReply(types: readonly string[], investment: boolean): string {
  const lines = types
    .map((t) => TYPE_TAXONOMY[t])
    .filter(Boolean)
    .map((s) => `• ${s}`);
  if (lines.length < 2) {
    return 'Happy to explain the property types — which two are you weighing (apartment, plot, villa, or plantation)?';
  }
  const head = `Great question — the core difference:\n${lines.join('\n')}`;
  const tail = investment
    ? '\n\nOn returns: apartments are usually held for rental income, plots/land for appreciation, and plantation estates for crop revenue — the right fit depends on your horizon and how hands-on you want to be. Want me to show options in either?'
    : '\n\nWant me to show options in either?';
  return head + tail;
}

/** Phase 0b multi-intent — drop per-atom project-name headers under the shared lead. */
function stripProjectNameLead(line: string): string {
  return line
    .replace(/^For \*[^*]+\*,\s*/i, '')
    .replace(/^Regulatory snapshot for \*[^*]+\*:\s*/i, '')
    .replace(
      /^Legal and title details for \*[^*]+\* are on file with our team\.?$/i,
      'legal details on file with our team',
    )
    .trim();
}

/** Buyer-safe media line — shared by single-topic and AB-8 multi-topic paths.
 *  Successful shares never paste signed URLs into prose — channels render
 *  `media_attachments` as cards / native WhatsApp media. */
function mediaShareLine(
  media: NonNullable<EvidenceSet['media']>,
  focusProjectName?: string,
  opts?: { omitProjectName?: boolean },
): string {
  const asset = humanizeAsset(media.assetKind);
  // "Here's the site photos" — the lead has to agree with the label's number.
  const here = /s$/i.test(asset) ? 'here are' : "here's";
  if (media.allowed && media.cdnUrl) {
    if (opts?.omitProjectName) return `${here} the ${asset}`;
    const pname = media.projectName || focusProjectName || 'this project';
    return `${here.charAt(0).toUpperCase()}${here.slice(1)} the ${asset} for *${pname}*`;
  }
  const pname = media.projectName || focusProjectName || 'this project';
  // media.redirectHint / reason are INTERNAL composer instructions — Desk
  // authors them for the RM ("offer site visit; do not quote this number"),
  // never as buyer copy (see NayaDesk disclosure.ts). Translate the miss into
  // buyer-safe copy; never recite the hint.
  if (opts?.omitProjectName) {
    return `I don't have the ${humanizeAsset(media.assetKind)} on file yet — I can walk you through the details here or share it at your site visit`;
  }
  return `I don't have the ${humanizeAsset(media.assetKind)} for *${pname}* on file yet — I can walk you through the details here or share it at your site visit.`;
}

/** Buyer-facing name for a media asset kind — the vocabulary lives in media-asset.ts. */
const humanizeAsset = humanizeMediaKind;

function formatPriceComponent(c: { label: string; value: string }): string {
  const label = c.label.trim();
  let value = c.value.trim();
  if (/^starting from$/i.test(label)) {
    value = value.replace(/^from\s+/i, '').trim();
    return `Starting from ${value}`;
  }
  return `${label} ${value}`.replace(/\s+/g, ' ').trim();
}

function formatStartingPrice(display?: string): string {
  if (!display) return '';
  return display.replace(/^from\s+/i, '').trim();
}

/** Buyer-facing label per LI category (S1). Iteration order = render order. */
const LOCATION_CATEGORY_LABELS: ReadonlyArray<
  [import('./types.js').LocationCategoryKey, string]
> = [
  ['schools', 'Schools'],
  ['hospitals', 'Hospitals'],
  ['metroStations', 'Metro'],
  ['airports', 'Airport'],
  ['itParks', 'IT parks'],
  ['malls', 'Malls'],
  ['transitStations', 'Rail/bus'],
  ['universities', 'Colleges'],
  ['supermarkets', 'Supermarkets'],
  ['parks', 'Parks'],
];

function poiFactLine(p: import('./types.js').LocationPoi): string {
  const parts = [p.name];
  if (p.distanceKm !== undefined) parts.push(`${p.distanceKm} km`);
  if (p.driveMinutes !== undefined) parts.push(`~${p.driveMinutes} min drive`);
  return parts.join(', ');
}

/**
 * Desk-verified POIs by category — asked categories first with up to 3 places,
 * unasked context capped at 2 (S1). Empty categories are skipped so the
 * composer never sees an answerable-looking header with nothing behind it.
 */
function locationCategoryFacts(
  l: import('./types.js').LocationEvidence,
): Array<{ key: import('./types.js').LocationCategoryKey; label: string; pois: import('./types.js').LocationPoi[] }> {
  const asked = l.askedCategories ?? [];
  const orderedKeys = [
    ...asked,
    ...LOCATION_CATEGORY_LABELS.map(([k]) => k).filter((k) => !asked.includes(k)),
  ];
  const out: Array<{ key: import('./types.js').LocationCategoryKey; label: string; pois: import('./types.js').LocationPoi[] }> = [];
  for (const key of orderedKeys) {
    const pois = l[key];
    if (!pois?.length) continue;
    const label = LOCATION_CATEGORY_LABELS.find(([k]) => k === key)?.[1] ?? key;
    const cap = asked.length === 0 || asked.includes(key) ? 3 : 2;
    out.push({ key, label, pois: pois.slice(0, cap) });
  }
  return out;
}

/**
 * Closed Answer-map template id for place+connectivity (atoms → LLM slots).
 * Ops does not edit this skeleton; see answer-homes.ts.
 */
export const PLACE_CONNECTIVITY_TEMPLATE_ID = 'connectivity+place.v1';

/** Exported for tests. */
export function locationSnapshotLine(
  l: import('./types.js').LocationEvidence,
  opts?: { omitProjectName?: boolean },
): string {
  const pname = (l.projectName || 'This project').trim();
  const mm = (l.microMarket ?? '').trim();
  const bits: string[] = [];
  if (mm) bits.push(opts?.omitProjectName ? `located in ${mm}` : `*${pname}* is in ${mm}`);
  const asked = l.askedCategories ?? [];
  if (asked.length) {
    // The buyer asked about specific POI categories — answer those with named,
    // Desk-verified places (S1), not a generic connectivity recap.
    const askedFacts = locationCategoryFacts(l).filter((f) => asked.includes(f.key));
    for (const f of askedFacts.slice(0, 2)) {
      bits.push(`${f.label} nearby: ${f.pois.map(poiFactLine).join('; ')}`);
    }
    if (askedFacts.length) {
      if (bits.length) return bits.join('. ');
      return opts?.omitProjectName
        ? `${askedFacts[0]!.label} on file`
        : `*${pname}*: ${askedFacts[0]!.label} on file.`;
    }
  }
  if (l.microMarketOverview) bits.push(l.microMarketOverview);
  if (l.connectivitySummary) bits.push(l.connectivitySummary);
  if (l.nearbyPois?.length) bits.push(`Nearby: ${l.nearbyPois.slice(0, 3).join(', ')}`);
  if (l.driveTimes?.length) bits.push(l.driveTimes.slice(0, 2).join('; '));
  // Wave 3 — never emit "*X* is in ." when Desk left micro_market blank; honest miss.
  if (!bits.length) {
    return opts?.omitProjectName
      ? `I don't have connectivity / location details on file yet`
      : `I don't have connectivity / location details on file for *${pname}* yet`;
  }
  return bits.join('. ');
}

/**
 * Where a carried-forward number came from, said out loud. The buyer gave it
 * once, several turns ago; answering off it without naming it would read as the
 * bot inventing a figure — and would leave them no way to say "that's changed".
 */
function emiBasisLead(source: import('./types.js').EmiEvidence['basisSource']): string {
  if (!source) return '';
  if (source.kind === 'buyer_budget') {
    return `Working to the ${formatInr(source.budgetInr)} you're looking at — `;
  }
  const monthly = `₹${source.monthlyInr.toLocaleString('en-IN')}`;
  return source.fromIncome
    ? `Off the take-home you gave — about ${monthly} a month towards the instalment — `
    : `Working from the ${monthly} a month you mentioned — `;
}

function emiSnapshotLine(e: import('./types.js').EmiEvidence): string {
  const from = emiBasisLead(e.basisSource);
  if (!e.discloseInputs) {
    const down = e.downPaymentFormatted
      ? ` (~${e.downPaymentFormatted} down on ${e.basisFormatted})`
      : '';
    return `${from}Indicative EMI: *${e.emiFormatted}/month*${down} at ${e.ratePercent}% for ${e.tenureYears} years`;
  }
  if (e.basisKind === 'explicit_principal') {
    return `${from}Indicative EMI: *${e.emiFormatted}/month* on a ${e.principalFormatted} loan at ${e.ratePercent}% for ${e.tenureYears} years`;
  }
  const ltv = e.ltvPercent ?? 80;
  const down = e.downPaymentFormatted ? `; ~${e.downPaymentFormatted} down` : '';
  // A basis the BUYER gave is not a project price, and calling it one would put
  // a number in the builder's mouth.
  const against =
    e.basisSource?.kind === 'buyer_budget'
      ? `against ${e.basisFormatted}`
      : `against ${e.basisFormatted} project price`;
  return `${from}Indicative EMI: *${e.emiFormatted}/month* on a ${ltv}% loan (${e.principalFormatted} principal${down}) ${against}, at ${e.ratePercent}% for ${e.tenureYears} years`;
}

/**
 * The comparable rate, derived only where a published size and a published
 * price meet. Rounded to ₹10 and stated as "about" — it is arithmetic on the
 * starting price and the smaller end of the size band, not a quoted rate, and
 * the reply says so rather than passing a division off as a builder number.
 */
/**
 * Did this turn ask for a fact at all? A question mark, or an opening the
 * language reserves for asking. Deliberately narrow: when in doubt this returns
 * true and the buyer gets the file answer, which is the safer of the two.
 */
function perSqftLine(ps: NonNullable<EvidenceSet['perSqft']>, projectName: string): string {
  if (!ps.rows.length) return '';
  const body = ps.rows
    .map((r) => `${r.unitType} about ₹${r.rateInr.toLocaleString('en-IN')}/sqft`)
    .join(', ');
  return `On *${projectName}*, from the published sizes and starting prices: ${body}. That is the starting price over the smaller end of each size band, so read it as indicative — the cost sheet carries the quoted rate.`;
}

function landedCostLine(
  lc: import('./types.js').LandedCostEvidence,
  opts?: { omitProjectName?: boolean },
): string {
  const oneTime = lc.oneTime
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.display}`)
    .join('; ');
  const base = opts?.omitProjectName
    ? `cost breakdown (${lc.unitType}): base ${lc.baseDisplay}`
    : `*Cost breakdown — ${lc.projectName} (${lc.unitType}):* base ${lc.baseDisplay}`;
  const charges = oneTime ? `; ${oneTime}` : '';
  const total = lc.totalDisplay ? `; all-in ~${lc.totalDisplay}` : '';
  return `${base}${charges}${total}`;
}

/**
 * Which row of the comparison the buyer actually asked for.
 *
 * Read off the closed sets that already exist — the answer-contract FactKeys and
 * the Desk FAQ keys — so a new phrasing is taught in the same one place as
 * everywhere else. No new intent vocabulary lives here.
 */
const COMPARE_FACET_BY_KEY: Readonly<Record<string, string>> = Object.freeze({
  possession: 'possession',
  ready_to_move: 'possession',
  price: 'starting_price',
  pricing: 'starting_price',
  base_rate: 'starting_price',
  price_per_sqft: 'starting_price',
  project_type: 'project_type',
  project_type_summary: 'project_type',
  loan_eligibility: 'loan_eligibility',
  banks: 'loan_eligibility',
  location_schools: 'location',
  project_location: 'location',
  metro_connectivity: 'location',
  airport_distance: 'location',
  nearby_schools: 'location',
  nearby_hospitals: 'location',
  configurations: 'configurations',
  compact_units: 'configurations',
});

function compareFacetLead(
  buyerText: string,
  cmp: { tableText: string; matrix?: CompareMatrixPayload },
): string {
  const rows = cmp.matrix?.rows;
  const names = cmp.matrix?.projects?.map((p) => p.name) ?? [];
  if (!rows?.length || names.length < 2 || !buyerText.trim()) return '';

  const asked = [...answerRequirements(buyerText), ...resolveFaqQuestionKeys(buyerText)];
  const wanted = asked.map((k) => COMPARE_FACET_BY_KEY[k]).find(Boolean);
  if (!wanted) return '';

  const row = rows.find((r) => r.key === wanted);
  // The facet is real but this comparison has no row for it (maintenance, the
  // clubhouse, which is physically bigger). Repeating the same eight rows claims
  // they answer it. Say what the table holds and let them pick.
  if (!row) return '';

  const lines = names
    .map((n, i) => `• *${n}* — ${row.values[i]?.trim() || '—'}`)
    .join('\n');
  const others = rows
    .filter((r) => r.key !== wanted)
    .map((r) => r.label.toLowerCase())
    .slice(0, 3)
    .join(', ');
  return (
    `*${row.label}*\n${lines}` +
    (others ? `\n\nI can put ${others} side by side too — say which.` : '')
  );
}

function compareAdviceLine(
  buyerText: string,
  projects: Array<{ name?: string; starting_price_lakhs?: number; possession_date?: string }>,
): string {
  if (projects.length < 2) return '';
  const [a, b] = projects;
  if (/\bbudget\b/i.test(buyerText)) {
    const sorted = [...projects].sort(
      (x, y) => (x.starting_price_lakhs ?? 0) - (y.starting_price_lakhs ?? 0),
    );
    const lead = sorted[0];
    const next = sorted[1];
    if (lead?.name && next?.name) {
      const leadPrice =
        lead.starting_price_lakhs && lead.starting_price_lakhs > 0
          ? formatInr(Math.round(lead.starting_price_lakhs * 100_000))
          : '';
      const nextPrice =
        next.starting_price_lakhs && next.starting_price_lakhs > 0
          ? formatInr(Math.round(next.starting_price_lakhs * 100_000))
          : '';
      return `On your budget, *${lead.name}*${leadPrice ? ` starts lower at ${leadPrice}` : ' is the lower entry point'}${nextPrice ? `; *${next.name}* from ${nextPrice}` : `; *${next.name}* is the next step up`}. Both are on your board — tap one for full pricing.`;
    }
  }
  if (/\binvest/i.test(buyerText)) {
    const cheaper =
      (a?.starting_price_lakhs ?? 0) <= (b?.starting_price_lakhs ?? 0) ? a : b;
    return `For investment framing, *${cheaper?.name}* has the lower entry point on our catalog — open a project for stated ROI or corridor rent bands when we have them on file (never a promised return).`;
  }
  if (/\bfamil/i.test(buyerText)) {
    return `For families, compare location fit and configuration — both are in the table below. Tell me your must-haves and I can steer you.`;
  }
  return '';
}

function probeCopy(slot: ProbeKind): string {
  switch (slot) {
    case 'location':
      return 'Which area or part of the city are you looking in?';
    case 'budget':
      return 'What budget range are you working with?';
    case 'bhk':
      return 'How many bedrooms — 2 BHK, 3 BHK, something else?';
    case 'purpose':
      return 'Is this for you to live in, or as an investment?';
    case 'propertyType':
      return 'What kind of home are you picturing?';
    case 'worries':
      return "What quietly worries you about this purchase?";
    case 'schools':
      return 'Should I weigh school access?';
    case 'hub':
      return 'Where do you commute to?';
    case 'priority':
      return 'One quick thing so I rank these right — does a shorter commute matter more, or staying on budget?';
  }
}

/** Ack slots already on file so probe/orient never re-ask the whole brief. */
export function briefAckPrefix(c: Constraints | undefined): string {
  if (!c) return '';
  const bits: string[] = [];
  if (c.propertyType) bits.push(String(c.propertyType).replace(/_/g, ' '));
  if (c.bhk) bits.push(c.bhk);
  if (c.location?.trim()) bits.push(c.location.trim());
  if (c.budgetMaxInr) bits.push(`~${formatInr(c.budgetMaxInr)}`);
  if (c.purpose === 'investment') bits.push('investment');
  if (!bits.length) return '';
  return `Got it — ${bits.join(', ')}. `;
}

/**
 * Constraints-only FALLBACK for the orient sites that carry no state.
 *
 * `discover.firstMissingSlot` is the authority and reaches compose on
 * `orient.probeSlot` — it additionally knows which probes were already asked,
 * which is the whole difference: it answers `purpose` when a buyer has declined
 * to give a budget, and it never re-asks the declined budget. This copy cannot
 * know either of those things. It used to carry discover's purpose line too,
 * but without the `asked` set the condition (`!c.purpose && c.budgetMaxInr ===
 * undefined`) sat below an identical `budgetMaxInr === undefined` return and
 * could never be true — three stages wearing four. Removed rather than
 * "fixed": reordering it here would put a second, disagreeing ladder in the
 * codebase, which is what caused the divergence in the first place.
 */
export function firstMissingProbeSlot(c: Constraints | undefined): ProbeKind | undefined {
  if (!c?.location?.trim()) return 'location';
  if (c.budgetMaxInr === undefined) return 'budget';
  // Align with discover: skip BHK for investment + non-apartment property types.
  const needsBhk =
    c.purpose !== 'investment' &&
    (!c.propertyType?.trim() ||
      /apartment|flat/i.test(c.propertyType) ||
      !/(plantation|planted|estate|villa|plot|land|bungalow)/i.test(c.propertyType));
  if (needsBhk && !c.bhk) return 'bhk';
  return undefined;
}

/** Unit price / asked cost-sheet row — never default to stamp duty as "the price". */
function priceLeadForAsk(
  p: {
    components: ReadonlyArray<{ label: string; value: string }>;
    startingDisplay?: string;
  },
  text: string,
  constraints: Constraints | undefined,
  detail?: { configurations?: ReadonlyArray<{ unitType: string; priceDisplay: string; priceMinInr: number }> },
): string {
  if (isCostComponentAsk(text)) {
    const asked = componentsForAsk(text, p.components);
    const shown = asked.length ? asked.slice(0, 4) : p.components.slice(0, 3);
    const parts = shown.map(formatPriceComponent).join(', ');
    return parts || formatStartingPrice(p.startingDisplay) || 'charges on file';
  }
  const bhk = constraints?.bhk?.trim();
  if (bhk && detail?.configurations?.length) {
    const n = /(\d+)/.exec(bhk)?.[1];
    const rows = detail.configurations.filter((c) =>
      n ? new RegExp(`\\b${n}\\s*bhk\\b`, 'i').test(c.unitType) : false,
    );
    const priced = rows.filter((c) => c.priceMinInr > 0 || c.priceDisplay.trim());
    if (priced.length) {
      const min = Math.min(...priced.map((c) => c.priceMinInr).filter((x) => x > 0));
      const display = priced.find((c) => c.priceDisplay.trim())?.priceDisplay || formatInr(min);
      if (display) return `${bhk} from ${display.replace(/^from\s+/i, '')}`;
    }
  }
  const start = formatStartingPrice(p.startingDisplay);
  if (start) return start;
  const startingRow = p.components.find((c) => /starting|base|bsp|selling/i.test(c.label));
  if (startingRow) return formatPriceComponent(startingRow);
  return 'pricing on file — ask for a size if you want a unit total';
}

/** Unit/BSP vs charges-only header for price answers. */
export function priceAnswerHeader(
  projectName: string,
  components: readonly { label: string }[],
  startingDisplay?: string,
): string {
  const hasUnitPrice =
    Boolean(startingDisplay?.trim()) ||
    components.some((c) =>
      /base|bsp|selling|rate|per\s*sq|starting|unit/i.test(c.label),
    );
  if (hasUnitPrice) return `Pricing — ${projectName}`;
  return `Charges on file — ${projectName}`;
}

function priceOf(m: Match): string {
  return m.startingPriceDisplay || (m.startingPriceInr > 0 ? formatInr(m.startingPriceInr) : '');
}

/**
 * Prefix a starting-price display with "from " ONLY when it is a single figure.
 * A band ("25-50L", "₹1.2Cr onwards", "₹499–650/sqft") is a range already, so
 * "from 25-50L" is wrong — render the band verbatim. Honesty-first: never
 * reformat or parse the band, just decide whether "from " is truthful.
 */
export function fromPrice(display?: string): string {
  const v = (display ?? '').trim();
  if (!v) return '';
  if (/[-–—/+]|\bto\b|onwards/i.test(v)) return v; // already a range/open-ended
  return `from ${v}`;
}

export function formatInr(inr: number): string {
  if (!isFinite(inr) || inr <= 0) return '';
  if (inr >= 10_000_000) return `₹${(inr / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  return `₹${(inr / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`;
}

// ── W4 — format once, at the adapter (templates stay dumb) ──────────────────
// Desk cost-sheet values arrive raw ("499", "5", "15000") and were dumped into
// replies verbatim ("Base land price 499, Stamp Duty 5"). Everything the
// adapter maps into evidence goes through these; no template formats anything.

const PERCENT_LABEL = /\b(?:duty|tax|gst|interest|percent|%)/i;

/**
 * Render a raw cost-sheet value for buyer copy.
 *
 * Desk ships each cost row as {value, kind} where `kind` IS the unit
 * ('per_sqft' | 'percent' | 'flat' | 'info'). When kind is present it is
 * authoritative — we format by it and never guess. This is the fix for the
 * "₹499" bug: Ayana's base land price is kind='per_sqft', value='499', i.e.
 * ₹499/sqft — rendering the bare number as a ₹ total was wrong.
 *
 * Only when kind is absent (older payloads) do we fall back to the honesty-
 * first label heuristic, which never invents a "/sqft" it can't infer:
 *   already formatted ("5% of land value", "Included", "₹39 L") → passthrough
 *   bare small number on a %-ish label ("Stamp Duty", "5")       → "5%"
 *   bare number ("15000")                                         → "₹15,000"
 */
export function formatCostValue(label: string, raw: string, kind?: string): string {
  const v = (raw ?? '').trim();
  if (!v) return v;
  const bare = v.replace(/,/g, '');
  const isNumeric = /^\d+(?:\.\d+)?$/.test(bare);
  const n = isNumeric ? Number(bare) : NaN;

  const k = kind?.trim().toLowerCase();
  if (k) {
    if (k === 'info') return v; // free text — already display-ready
    if (!isNumeric || !isFinite(n)) return v; // pre-formatted value → passthrough
    if (k === 'per_sqft') return `₹${n.toLocaleString('en-IN')}/sqft`;
    if (k === 'percent') return `${v}%`;
    if (k === 'flat') return n >= 100_000 ? formatInr(n) : `₹${n.toLocaleString('en-IN')}`;
    // unknown kind → fall through to the label heuristic below
  }

  if (!isNumeric || !isFinite(n)) return v; // has words/symbols → already display-ready
  if (n > 0 && n <= 30 && PERCENT_LABEL.test(label)) return `${v}%`;
  if (n >= 100_000) return formatInr(n);
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * Possession strings are builder free text ("Ready to register", "Phase-wise;
 * Dioro & Beryl: June 2028. Earlier phases ready for possession..") and were
 * shoved into "possession {x}" sentences with double periods and run-ons.
 * Normalise: collapse repeated periods, strip the trailing one, and keep only
 * the first clause when the note runs long (the full text lives in FAQs).
 */
export function formatPossession(raw: string): string {
  let s = (raw ?? '').trim().replace(/\.{2,}/g, '.').replace(/\.$/, '');
  if (s.length > 60) {
    // Keep the first SENTENCE — "Phase-wise; Dioro & Beryl: June 2028" holds
    // the date a buyer needs; the trailing prose lives in FAQs.
    const cut = s.indexOf('.');
    if (cut > 10) s = s.slice(0, cut);
  }
  return s.trim();
}

/**
 * W7 — one buyer-ready phase caveat from the Desk journey composer's per-phase
 * output. RERA registers PER PHASE: a pre-RERA phase may take holds/EOI but no
 * booking money, and the bot must say so instead of being phase-blind. Only
 * the caveat-worthy case renders — fully registered projects get ''.
 */
export function phaseNoteFrom(
  journeys: Array<{ phase_label: string; money_allowed: boolean; primary?: string }> | undefined,
): string {
  if (!journeys?.length) return '';
  const gated = journeys.filter((j) => !j.money_allowed);
  if (gated.length === 0) return '';
  const g = gated.find((j) => j.primary) ?? gated[0]!;
  const scope = journeys.length === 1 ? 'This phase' : `${g.phase_label}`;
  return `${scope} is pre-RERA — booking opens at registration; holds and expressions of interest are available now.`;
}

/**
 * One price BAND truth (over-answer fix): low–high derived from the configs —
 * the same rows the search rail's starting price comes from, so the overview
 * card can never contradict the recommend line. Falls back to the configured
 * band string only when no config carries a price.
 */
export function priceBandDisplayFrom(
  configs: Array<{ priceMinInr: number; priceMaxInr?: number }>,
  fallbackBand: string | undefined,
): string {
  const mins = configs.map((c) => c.priceMinInr).filter((n) => isFinite(n) && n > 0);
  const maxs = configs.map((c) => c.priceMaxInr ?? 0).filter((n) => isFinite(n) && n > 0);
  if (mins.length) {
    const lo = formatInr(Math.min(...mins));
    const hi = maxs.length ? formatInr(Math.max(...maxs, Math.max(...mins))) : '';
    return hi && hi !== lo ? `${lo} – ${hi}` : `from ${lo}`;
  }
  return (fallbackBand ?? '').trim();
}

/**
 * The founder-specified project overview card — what "tell me about X" says:
 * name + location, the configuration types, ONE price band (low–high, from
 * configs), possession — then exactly one probing question. Never the FAQ
 * catalog; facet questions get facet answers on the next turn.
 *
 * Catalog-first: the one narrative line comes from the catalog's own summary
 * field (a tab the builder maintains), never from FAQ rows — capped and cut
 * at a sentence boundary so the card stays a card.
 */
const SUMMARY_BLURB_CAP = 220;

export function summaryBlurb(summary: string | undefined): string {
  const s = (summary ?? '').replace(/\s+/g, ' ').trim();
  // Too short to be a real narrative (empty, or a stray token) — skip.
  if (s.length < 20) return '';
  let out = s;
  if (out.length > SUMMARY_BLURB_CAP) {
    const cut = out.slice(0, SUMMARY_BLURB_CAP);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '));
    out = lastStop > 60 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  }
  if (!/[.!…?]$/.test(out)) out = `${out}.`;
  return ` ${out}`;
}

export function overviewCard(
  d: NonNullable<EvidenceSet['detail']>,
  opts?: { priorReply?: string; seed?: string },
): string {
  const cfgs = d.configurations ?? [];
  const types = cfgs.map((c) => c.unitType).filter(Boolean);
  const typesLine = types.length
    ? types.length > 1
      ? `${types.slice(0, -1).join(', ')} & ${types[types.length - 1]}`
      : types[0]!
    : '';
  const band = priceBandDisplayFrom(cfgs, d.startingPriceDisplay);
  const bits = [typesLine, band, d.possession ? `possession ${d.possession}` : ''].filter(Boolean);
  const where = d.microMarket ? ` — ${d.microMarket}` : '';
  const facts = bits.length ? ` ${bits.join(' · ')}.` : '';
  const phase = d.phaseNote ? ` ${d.phaseNote}.` : '';
  const blurb = summaryBlurb(d.summary);
  // Overview keeps a short probing question (founder-spec card), but rotates
  // the ask so every project card does not end on the same visit prompt.
  //
  // The seed used to be the project name alone, which is CONSTANT for a given
  // project — so the rotation never rotated: one project got one sentence for
  // the life of the conversation, and "Curious about loan eligibility?" landed
  // 102 times in 970 turns. The seed now moves with the turn, and whatever the
  // last reply closed with is struck from the pool outright.
  const pool = [
    CLOSERS.overview_three.text,
    CLOSERS.overview_loan.text,
    CLOSERS.overview_cost.text,
  ];
  const priorText = opts?.priorReply ? composedOfferIn(opts.priorReply)?.text.trim() : undefined;
  const fresh = pool.filter((text) => text.trim() !== priorText);
  const closer = rotate(fresh.length ? fresh : pool, opts?.seed ?? d.name + (d.microMarket ?? ''));
  return `*${d.name}*${where}.${facts}${phase}${blurb}${closer}`;
}

/**
 * ONE starting-price truth (LLD W4): the minimum configuration price, same
 * number the search rail shows — so "from ₹31 L" on the recommend line and
 * the detail line can never disagree. The configured band is the fallback
 * when no config carries a price, prefixed so it reads as a range.
 */
export function startingPriceDisplayFrom(
  configMinsInr: number[],
  entryPriceBand: string | undefined,
): string {
  const mins = configMinsInr.filter((n) => isFinite(n) && n > 0);
  if (mins.length) return formatInr(Math.min(...mins));
  const band = (entryPriceBand ?? '').trim();
  return band;
}

export function minimumBudgetReply(
  typeLabel: string,
  floor: { name: string; display: string },
  buyerBudgetMaxInr?: number,
): string {
  const briefBit = buyerBudgetMaxInr ? ` Your brief is ${formatInr(buyerBudgetMaxInr)}.` : '';
  return `${typeLabel}s on our books start from *${floor.display}* (*${floor.name}*).${briefBit} Pick an option below to adjust area, budget, or property type.`;
}
