/**
 * Fact extraction — deterministic closed-set + bounded LLM signals for open-set.
 * Surfaces facts only; never picks reply shape (phase machine owns goals).
 */
import type { EngineLlm } from './ports.js';
import type { IngressSlotKey } from './ingress.js';
import { isSlotWritable } from './ingress.js';
import type { ConversationState, Extracted, OfferedProject, AnswerTopic, ObjectionTopic } from './types.js';
import { extractDayWord, isVisitDayUtterance } from './visit-slot.js';

const AFFIRM = /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|haan?|theek|done|confirm(?:ed)?|go ahead|sounds good|perfect|great)\b/i;
const REJECT =
  /\b(?:not (?:that|this|those|these)|don'?t want|too (?:far|expensive|costly|pricey|much|high)|skip (?:that|this)|nah|no,? not|something (?:else|cheaper))\b/i;
const NAME_RE = /\b(?:[Ii]\s*am|[Ii]'?m|[Mm]y name is|[Tt]his is|[Nn]ame'?s)\s+([A-Z][a-zA-Z]{1,30})\b/;
const WANTS_MORE_RE =
  /\b(?:other options?|show me (?:the )?(?:o?ptions?|otpions?|other projects?)|show options|more options?|more projects?|anything else|what else|see others?|alternatives?|options dikhao|list (?:the )?options?|some other)\b/i;
const VISIT_RECALL_RE =
  /\b(?:my|all|the) (?:site )?(?:visits?|bookings?)\b|visits? (?:i have )?(?:planned|booked|scheduled)/i;
const COMPARE_ADVICE_RE =
  /\b(which one is better|which is better|better for|recommend between|which fits my budget|best for my budget|fits my budget best)\b/i;
const STOP_RE =
  /\b(?:stop|unsubscribe|opt out|delete my data|forget me|don't (?:message|text|contact)|do not (?:message|text|contact))\b/i;
const SMALLTALK_RE = /\b(?:how are you|how'?s it going|how do you do|what'?s up)\b/i;
const POST_VISIT_ACK_RE =
  /^(?:ok(?:ay)?|thanks?(?: you)?|thank you|cool|great|got it|noted|perfect|sounds good|cheers)\.?!?\s*$/i;
const OBJECTION_NEGATIVE_RE = /\b(?:any\s+discount|best\s+price|negotiable)\b/i;
const OBJECTION_EN_RE =
  /\b(?:too\s+(?:expensive|far|risky|high|costly)|(?:feels|seems|looks|is|bit)\s+(?:too\s+)?(?:expensive|pricey|high|overpriced)|on\s+the\s+(?:higher|expensive)\s+side|out\s+of\s+(?:budget|range)|over\s+budget|not\s+convinced|not\s+sure(?:\s+about\s+(?:this|the\s+project))?|seems\s+too\s+far|too\s+old)\b/i;
const HINGLISH_LOC_BUDGET_RE =
  /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\s+(\d+(?:\.\d+)?)\s*( lakh| lakhs| l| cr| crore| crores)\s+budget\s+hai\b/i;
const HINGLISH_LOC_BHK_BUDGET_RE =
  /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\s+(\d)\s*bhk\s+chahiye\s+budget\s+(\d+(?:\.\d+)?)\s*( lakh| lakhs| l| cr| crore| crores)/i;

export interface ExtractFactsOptions {
  inputSource?: 'chip' | 'free_text';
  ingressFilledSlots?: ReadonlySet<IngressSlotKey>;
}

/** Chip ingress — dialogue signals only; RTI owns slot patches. */
export function extractFactsChip(text: string): Extracted {
  const t = text.trim();
  const affirm = AFFIRM.test(t);
  const decline =
    /\b(?:no|nope|nah|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i.test(t) &&
    !affirm;
  return {
    constraints: {},
    transition: 'none',
    affirm,
    decline,
    ...(STOP_RE.test(text) ? { stop: true } : {}),
    ...(VISIT_RECALL_RE.test(text) ? { recall: true } : {}),
    ...(extractDayWord(text) || /\bvisit\b/i.test(text) ? { visitSlotText: text } : {}),
  };
}

export async function extractFacts(
  text: string,
  s: ConversationState,
  llm: EngineLlm,
  options?: ExtractFactsOptions,
): Promise<Extracted> {
  if (options?.inputSource === 'chip') {
    return extractFactsChip(text);
  }

  const filled = options?.ingressFilledSlots ?? new Set<IngressSlotKey>();
  const t = text.trim();
  const budget =
    isSlotWritable('budget', filled, text) ? parseBudgetToInr(text) : null;
  const budgetPickQuestion = isBudgetPickQuestion(text);
  const budgetFitQuestion = !budgetPickQuestion && isBudgetFitQuestion(text, budget);
  const bhk = isSlotWritable('bhk', filled, text) ? normalizeConfig(text) : undefined;
  const ordinal = detectOrdinal(text);
  const affirm = AFFIRM.test(t);
  const decline =
    /\b(?:no|nope|nah|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i.test(t) &&
    !affirm;
  const nameM = NAME_RE.exec(text);
  const isQuestion = text.includes('?');
  const purposeKw = isSlotWritable('purpose', filled, text) ? detectPurpose(text) : undefined;
  const transitionKw = detectTransition(text);
  const propertyTypeKw = isSlotWritable('propertyType', filled, text) ? detectPropertyTypes(text) : undefined;
  const askTopics = detectTopics(text);
  const askTopic = askTopics[0];
  const shownName = detectShownName(text, s);
  const smalltalk = SMALLTALK_RE.test(text) && !budget && !bhk && askTopics.length === 0;
  const postVisitAck =
    POST_VISIT_ACK_RE.test(t) ||
    (affirm && !isQuestion && askTopics.length === 0 && t.split(/\s+/).length <= 3);
  const stop = STOP_RE.test(text);
  const negatesShown =
    !!shownName &&
    !affirm &&
    ordinal === null &&
    /\b(?:not|don'?t|do not|no|skip|drop|other than|except)\b/i.test(text);
  const reject = REJECT.test(text) || negatesShown;
  const recall = VISIT_RECALL_RE.test(text);
  const wantsMore = WANTS_MORE_RE.test(text);
  const compareAdvice = COMPARE_ADVICE_RE.test(text);
  const objection =
    !budget && !isQuestion && !OBJECTION_NEGATIVE_RE.test(text) && OBJECTION_EN_RE.test(text);
  const namedProjects = resolveNamed(text, s);
  const emiRate = parseEmiRate(text);
  const emiTenure = parseEmiTenure(text);
  const mediaAssetKind = detectMediaAssetKind(text);

  const constraints: Extracted['constraints'] = {};
  const hinglishBhk = isSlotWritable('budget', filled, text) && isSlotWritable('bhk', filled, text) && isSlotWritable('location', filled, text)
    ? HINGLISH_LOC_BHK_BUDGET_RE.exec(text)
    : null;
  const hinglishBudget =
    isSlotWritable('budget', filled, text) && isSlotWritable('location', filled, text)
      ? HINGLISH_LOC_BUDGET_RE.exec(text)
      : null;
  if (hinglishBhk) {
    constraints.location = hinglishBhk[1].trim();
    constraints.bhk = `${hinglishBhk[2]} BHK`;
    constraints.budgetMaxInr = toInr(parseFloat(hinglishBhk[3]), hinglishBhk[4] ?? '') ?? undefined;
  } else if (hinglishBudget) {
    constraints.location = hinglishBudget[1].trim();
    constraints.budgetMaxInr = toInr(parseFloat(hinglishBudget[2]), hinglishBudget[3] ?? '') ?? undefined;
  } else if (budget) {
    constraints.budgetMaxInr = budget.max;
    if (budget.min !== undefined) constraints.budgetMinInr = budget.min;
  }
  if (bhk && !constraints.bhk) constraints.bhk = bhk;
  if (
    !constraints.location &&
    askTopic !== 'compare' &&
    !isVisitDayUtterance(text) &&
    isSlotWritable('location', filled, text)
  ) {
    constraints.location = extractLocation(text, { phase: s.phase, askTopics });
  }
  if (propertyTypeKw) constraints.propertyType = propertyTypeKw;
  if (purposeKw) constraints.purpose = purposeKw;

  const needLlm: Array<'location' | 'property_type' | 'purpose' | 'transition'> = [];
  if (
    !constraints.location &&
    askTopics.length === 0 &&
    s.phase !== 'focused' &&
    s.phase !== 'visit' &&
    isSlotWritable('location', filled, text)
  ) {
    needLlm.push('location');
  }
  if (!constraints.propertyType && isSlotWritable('propertyType', filled, text)) needLlm.push('property_type');
  if (!constraints.purpose && !purposeKw && isSlotWritable('purpose', filled, text)) needLlm.push('purpose');
  if (!transitionKw) needLlm.push('transition');

  let transitionFromLlm: Extracted['transition'] | undefined;
  if (needLlm.length > 0) {
    const signals = await llm.extractSignals(text, needLlm).catch(() => []);
    for (const sig of signals) {
      if (sig.kind === 'location' && !constraints.location) constraints.location = sig.value;
      if (sig.kind === 'property_type' && !constraints.propertyType) {
        constraints.propertyType = normalizePropertyType(sig.value);
      }
      if (sig.kind === 'purpose' && !constraints.purpose) {
        const p = sig.value;
        if (p === 'self_use' || p === 'investment') constraints.purpose = p;
      }
      if (
        sig.kind === 'transition' &&
        (sig.value === 'want_details' || sig.value === 'see_others' || sig.value === 'want_visit')
      ) {
        transitionFromLlm = sig.value;
      }
    }
  }

  const transition = transitionKw ?? transitionFromLlm;
  const detailsPick = detectDetailsPick(text, s);
  const shortlistPick = matchOfferedName(text, s.discover.lastOffered);
  const implicitProjectPick = wantsImplicitProjectPick(text, s.discover.lastOffered, s.focus);
  const pickName =
    detailsPick ??
    shortlistPick ??
    (shownName && !reject && askTopic !== 'compare' && namedProjects.length <= 1 ? shownName : undefined);

  return {
    constraints,
    ...(reject ? { rejected: true, ...(shownName ? { rejectedName: shownName } : {}) } : {}),
    ...(ordinal !== null ? { pickOrdinal: ordinal } : {}),
    ...(pickName ? { pickName } : {}),
    ...(implicitProjectPick ? { implicitProjectPick: true } : {}),
    affirm,
    decline,
    ...(nameM?.[1] ? { nameIntro: nameM[1] } : {}),
    transition: transition ?? 'none',
    ...(askTopic ? { askTopic } : {}),
    ...(askTopics.length ? { askTopics } : {}),
    isQuestion,
    ...(objection ? { objection: true, objectionTopic: mapObjectionTopic(text) } : {}),
    wantsMore,
    recall,
    smalltalk,
    ...(postVisitAck ? { postVisitAck: true } : {}),
    ...(stop ? { stop: true } : {}),
    ...(extractDayWord(text) || /\bvisit\b/i.test(text) ? { visitSlotText: text } : {}),
    ...(namedProjects.length ? { namedProjects } : {}),
    ...(compareAdvice ? { compareAdvice: true } : {}),
    ...(budgetPickQuestion ? { budgetPickQuestion: true, compareAdvice: true } : {}),
    ...(emiRate !== undefined ? { emiRatePercent: emiRate } : {}),
    ...(emiTenure !== undefined ? { emiTenureYears: emiTenure } : {}),
    ...(mediaAssetKind ? { mediaAssetKind } : {}),
    ...(budgetFitQuestion ? { budgetFitQuestion: true } : {}),
  };
}

/** Sync extraction for unit tests without LLM. */
export function extractFactsSync(
  text: string,
  s: ConversationState,
  options?: ExtractFactsOptions,
): Extracted {
  if (options?.inputSource === 'chip') {
    return extractFactsChip(text);
  }

  const filled = options?.ingressFilledSlots ?? new Set<IngressSlotKey>();
  const budget = isSlotWritable('budget', filled, text) ? parseBudgetToInr(text) : null;
  const budgetPickQuestion = isBudgetPickQuestion(text);
  const budgetFitQuestion = !budgetPickQuestion && isBudgetFitQuestion(text, budget);
  const constraints: Extracted['constraints'] = {};
  if (budget) constraints.budgetMaxInr = budget.max;
  const askTopics = detectTopics(text);
  const loc =
    isSlotWritable('location', filled, text)
      ? extractLocation(text, { phase: s.phase, askTopics })
      : undefined;
  if (loc) constraints.location = loc;
  const bhk = isSlotWritable('bhk', filled, text) ? extractConfigurationFilters(text) : undefined;
  if (bhk) constraints.bhk = bhk;
  const propertyType = isSlotWritable('propertyType', filled, text) ? detectPropertyTypes(text) : undefined;
  if (propertyType) constraints.propertyType = propertyType;
  const purpose = isSlotWritable('purpose', filled, text) ? detectPurpose(text) : undefined;
  if (purpose) constraints.purpose = purpose;
  const askTopic = askTopics[0];
  const transitionKw = detectTransition(text);
  const namedProjects = resolveNamed(text, s);
  const detailsPick = detectDetailsPick(text, s);
  const shortlistPick = matchOfferedName(text, s.discover.lastOffered);
  const pickName = detailsPick ?? shortlistPick;
  const ordinal = detectOrdinal(text);
  const affirm = AFFIRM.test(text.trim());
  const implicitProjectPick = wantsImplicitProjectPick(text, s.discover.lastOffered, s.focus);
  return {
    constraints,
    transition: transitionKw ?? 'none',
    wantsMore: WANTS_MORE_RE.test(text),
    isQuestion: text.includes('?'),
    affirm,
    ...(askTopic ? { askTopic } : {}),
    ...(askTopics.length ? { askTopics } : {}),
    ...(namedProjects.length ? { namedProjects } : {}),
    ...(pickName ? { pickName } : {}),
    ...(ordinal !== null ? { pickOrdinal: ordinal } : {}),
    ...(implicitProjectPick ? { implicitProjectPick: true } : {}),
    ...(budgetPickQuestion ? { budgetPickQuestion: true, compareAdvice: true } : {}),
    ...(budgetFitQuestion ? { budgetFitQuestion: true } : {}),
  };
}

/** Buyer asking whether shown options fit a budget — not a single-project price ask. */
export function isBudgetFitQuestion(text: string, parsedBudget?: { max: number; min?: number } | null): boolean {
  if (isBudgetPickQuestion(text)) return false;
  const t = text.trim();
  const budget = parsedBudget ?? parseBudgetToInr(text);
  const asksFit =
    /\b(?:come in|fit(?:ting)?|afford(?:able)?|available at|within)\b/i.test(t) ||
    /\b(?:do|does|can|will|are)\s+(?:they|it|these|those|any)\b/i.test(t) ||
    /\banything (?:in|at|under|below)\b/i.test(t);
  const hasBudgetPhrase = /\b(?:within|at|for|my|our)\s+budget\b/i.test(t);
  if (hasBudgetPhrase && (t.includes('?') || asksFit)) return true;
  if (budget && asksFit) return true;
  return false;
}

/** "Which fits my budget best?" — steer among offered projects, not re-search. */
export function isBudgetPickQuestion(text: string): boolean {
  return (
    /\b(?:which|what).{0,40}(?:fits?|best|closest|works?).{0,40}(?:my\s+)?budget\b/i.test(text) ||
    /\b(?:best for my budget|fits my budget best|within my budget which)\b/i.test(text)
  );
}

function normalizePropertyType(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('plantation') || s.includes('estate') || s.includes('planted')) return 'plantation';
  if (s.includes('villa')) return 'villa';
  if (s.includes('apartment') || s.includes('flat')) return 'apartment';
  if (s.includes('plot') || s.includes('land') || s.includes('plotted')) return 'plot';
  return raw;
}

export function detectPropertyTypes(text: string): string | undefined {
  const found = new Set<string>();
  for (const segment of text.split(/\bor\b|,/i)) {
    const t = detectPropertyType(segment);
    if (t) found.add(t);
  }
  const whole = detectPropertyType(text);
  if (whole) found.add(whole);
  if (found.size === 0) return undefined;
  return [...found].join(',');
}

function detectPropertyType(text: string): string | undefined {
  const s = text.toLowerCase();
  if (/\b(?:plantation|planted estate|managed.?plantation|coffee estate)\b/.test(s)) return 'plantation';
  if (/\b(?:apartments?|flats?)\b/.test(s)) return 'apartment';
  if (/\b(?:villas?)\b/.test(s)) return 'villa';
  if (/\b(?:plots?|plot\s*\/\s*land|land parcel|plotted)\b/.test(s)) return 'plot';
  return undefined;
}

function resolveNamed(_text: string, _s: ConversationState): OfferedProject[] {
  // Project names come from PROJECT_VECTORS in semantic.enrich — not regex.
  return [];
}

function mapObjectionTopic(text: string): ObjectionTopic {
  const s = text.toLowerCase();
  if (/\b(?:expensive|costly|budget|over budget|price)\b/.test(s)) return 'price';
  if (/\b(?:possession|timeline|late|too long)\b/.test(s)) return 'timeline';
  if (/\b(?:rera|legal|title|khata)\b/.test(s)) return 'legal';
  if (/\b(?:far|location|connectivity|distance)\b/.test(s)) return 'location';
  if (/\b(?:reviews?|trust|builder|reputation)\b/.test(s)) return 'reputation';
  if (/\b(?:resale|competitor)\b/.test(s)) return 'competition';
  return 'custom';
}

/** Buyer asks what budget is needed for a property type (recovery / no-fit context). */
export function isMinimumBudgetForTypeQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(?:minimum|min\.?|least|lowest|what|how much)\b.{0,48}\b(?:budget|price|cost|spend)\b.{0,32}\b(?:villa|apartment|flat|plot|land|plantation)s?\b/.test(
      t,
    ) ||
    /\b(?:villa|apartment|flat|plot|land|plantation)s?\b.{0,32}\b(?:minimum|min\.?|start(?:ing)?|least)\b.{0,24}\b(?:budget|price|cost)\b/.test(
      t,
    ) ||
    /\bwhat(?:'s| is) the minimum budget\b/.test(t)
  );
}

export function parseBudgetToInr(raw: string): { max: number; min?: number } | null {
  const s = raw
    .toLowerCase()
    .replace(/₹|\brs\.?|\binr\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:bhk|bedrooms?)\b/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:%|percent)/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:years?|yrs?|months?)\b/g, ' ');
  const range = s.match(
    /(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|cr|crores?)?\s*(?:[-–—]|to|and)\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|cr|crores?)?/,
  );
  if (range) {
    const lo = toInr(parseFloat(range[1]!), range[2] ?? range[4] ?? '');
    const hi = toInr(parseFloat(range[3]!), range[4] ?? range[2] ?? '');
    if (lo !== null && hi !== null && hi > 0) {
      return hi >= lo ? { min: lo, max: hi } : { min: hi, max: lo };
    }
  }
  const single = s.match(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|cr|crores?)?(?=\s|$|[^\w])/);
  if (!single) return null;
  const v = toInr(parseFloat(single[1]!), single[2] ?? '');
  return v !== null && v > 0 ? { max: v } : null;
}

function toInr(n: number, unit: string): number | null {
  if (!isFinite(n) || n <= 0) return null;
  const u = unit.trim();
  if (u === 'cr' || u.startsWith('crore')) return Math.round(n * 10_000_000);
  if (u === 'l' || u.startsWith('lakh') || u.startsWith('lac')) return Math.round(n * 100_000);
  return n < 100 ? Math.round(n * 100_000) : Math.round(n);
}

export function normalizeConfig(raw: string): string | null {
  const configs = extractConfigurationFilters(raw);
  return configs ?? null;
}

/** BHK labels and plot-size phrases for unit_config matching. */
export function extractConfigurationFilters(raw: string): string | undefined {
  const labels: string[] = [];
  for (const m of raw.matchAll(/([1-5](?:\.5)?)\s*(?:bhk|bedroom)s?\b/gi)) {
    labels.push(`${m[1]} BHK`);
  }
  if (/\b(?:studio|1\s*rk)\b/i.test(raw)) labels.push('Studio');

  for (const segment of raw.split(/\bor\b|,/i)) {
    const t = segment.trim();
    if (!t || /\bbhk\b/i.test(t)) continue;
    if (/\b(?:sq\.?\s*ft|sqft|acre|acres|cent|cents|ground|guntas?)\b/i.test(t)) {
      labels.push(t.replace(/^\W+|\W+$/g, ''));
      continue;
    }
    if (/\b(?:quarter|half|one)\s+acre\b/i.test(t)) {
      labels.push(t.replace(/^\W+|\W+$/g, ''));
    }
  }

  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  return unique.length ? unique.join(',') : undefined;
}

const ORDINAL: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
};

function detectOrdinal(text: string): number | null {
  const s = text.toLowerCase();
  for (const [w, n] of Object.entries(ORDINAL)) {
    if (new RegExp(`\\b${w}\\b`).test(s)) return n;
  }
  const opt = s.match(/\boption\s*([1-4])\b|\bnumber\s*([1-4])\b/);
  if (opt) return parseInt(opt[1] ?? opt[2] ?? '', 10) || null;
  return null;
}

function detectPurpose(text: string): 'self_use' | 'investment' | undefined {
  const s = text.toLowerCase();
  if (/\b(?:invest|investment|rental|returns?)\b/.test(s)) return 'investment';
  if (/\b(?:live|stay|self[- ]?use|family|move in)\b/.test(s)) return 'self_use';
  return undefined;
}

function detectTransition(text: string): Extracted['transition'] | undefined {
  const s = text.toLowerCase();
  if (/\b(?:details?|tell me more|more about|know more|give me details|full details)\b/.test(s)) {
    return 'want_details';
  }
  if (/\b(?:other options?|show me others?|alternatives?)\b/.test(s)) return 'see_others';
  if (/\b(?:visit|site visit|see it|tour)\b/.test(s)) return 'want_visit';
  return undefined;
}

function detectShownName(_text: string, _s: ConversationState): string | undefined {
  // Shown-name substring matching removed — project identity is PROJECT_VECTORS.
  return undefined;
}

const TOPIC_ORDER: AnswerTopic[] = ['compare', 'price', 'legal', 'property_type', 'location', 'emi', 'amenities', 'availability', 'media'];

const TOPIC_PATTERNS: ReadonlyArray<{ topic: AnswerTopic; re: RegExp }> = [
  { topic: 'compare', re: /\b(?:compare|vs|versus|side by side|difference between|both projects?)\b/i },
  {
    topic: 'price',
    re: /\b(?:price|pricing|cost|how much|pricing batao|landed cost|all[- ]in cost|price break[- ]?up|breakdown|component[- ]wise)\b/i,
  },
  {
    topic: 'legal',
    re: /\b(?:rera|legal|khata|title|approval|documents?|legal status|legal details|clear title|title clear|\bec\b|encumbrance(?: certificate)?|(?:which|what)\s+banks?|banks?\s+(?:approved|approv|approving)|approved\s+banks?|home\s+loan\s+approv|is\s+(?:the\s+)?ec\s+clear)\b/i,
  },
  {
    topic: 'property_type',
    re: /\b(?:is this (?:a |an )?(?:apartment|plot|villa|flat|plantation)|is it (?:a |an )?(?:apartment|plot|villa|flat)|(?:apartment|plot|villa|flat)s?\s+or\s+(?:apartment|plot|villa|flat)s?|what type of (?:property|project)|property type|what kind of (?:property|project))\b/i,
  },
  {
    topic: 'location',
    re: /\b(?:location details?|where(?:'s| is)(?: it| this)?\s*\?|connectivity|distance|how far|nearby|map|directions?|micro[- ]?market)\b|^location\s*\?$/i,
  },
  { topic: 'emi', re: /\b(?:emi|loan|monthly payment|installment)\b/i },
  { topic: 'amenities', re: /\b(?:amenit|facilit|clubhouse|pool|gym)\b/i },
  { topic: 'availability', re: /\b(?:possession|ready|available|when.*ready|units?|configurations?|bhk options?|plot\s+sizes?|unit\s+sizes?|unit\s+configurations?|sizes?\s+offered|sq\.?\s*ft\s+(?:options?|sizes?)|what\s+(?:sizes?|configs?|configurations?)\b)\b/i },
  { topic: 'media', re: /\b(?:brochure|floor plan|layout|video|photos?|images?|pdf|share (?:the )?(?:brochure|plan))\b/i },
];

/** All answer topics mentioned this turn (multi-intent). */
export function detectTopics(text: string): AnswerTopic[] {
  const found = new Set<AnswerTopic>();
  for (const { topic, re } of TOPIC_PATTERNS) {
    if (re.test(text)) found.add(topic);
  }
  return TOPIC_ORDER.filter((t) => found.has(t));
}

function detectTopic(text: string): AnswerTopic | undefined {
  return detectTopics(text)[0];
}

function parseEmiRate(text: string): number | undefined {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:interest|rate|pa)?\b/i);
  return m ? parseFloat(m[1]!) : undefined;
}

function parseEmiTenure(text: string): number | undefined {
  const m = text.match(/\b(\d+)\s*(?:year|yr)s?\b/i);
  return m ? parseInt(m[1]!, 10) : undefined;
}

function detectMediaAssetKind(text: string): string | undefined {
  const s = text.toLowerCase();
  if (/\b(?:floor plan|layout|unit plan)\b/.test(s)) return 'floor_plan';
  if (/\b(?:video|walkthrough|tour)\b/.test(s)) return 'video';
  if (/\b(?:photo|image|gallery)\b/.test(s)) return 'photo';
  if (/\b(?:brochure|pdf|e-?brochure)\b/.test(s)) return 'brochure';
  return undefined;
}

export function wantsImplicitProjectPick(
  text: string,
  offered: readonly OfferedProject[],
  focus?: { projectId: string; projectName: string },
): boolean {
  const s = text.toLowerCase();
  const refersToThisProject =
    /\b(?:details?|info|more)\s+(?:on\s+)?(?:the|this)\s+project\b/.test(s) ||
    /\b(?:give me|want|need)\b.*\bdetails?\b.*\b(?:the|this)\s+project\b/.test(s) ||
    /\b(?:the|this)\s+project(?:'s)?\s+details?\b/.test(s);
  if (!refersToThisProject) return false;
  return offered.length >= 1 || Boolean(focus);
}

/** Buyer asking for component-wise / all-in pricing — fetch landed-cost evidence. */
export function wantsCostBreakdown(text: string): boolean {
  return /\b(?:breakdown|break[- ]?up|landed cost|all[- ]in(?:\s+cost)?|component[- ]wise|cost break)\b/i.test(
    text,
  );
}

/** Price/legal/detail turn — must not mutate location or release focus. */
export function isDetailAskTurn(
  ex: Pick<Extracted, 'askTopic' | 'askTopics' | 'transition' | 'implicitProjectPick'>,
): boolean {
  const topics = (ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : [])).filter((t) => t !== 'compare');
  if (topics.length > 0) return true;
  if (ex.transition === 'want_details' || ex.implicitProjectPick) return true;
  return false;
}

export type ExtractLocationContext = {
  phase?: ConversationState['phase'];
  askTopics?: AnswerTopic[];
};

export function isLocationBroadenTurn(text: string): boolean {
  return (
    /\b(?:projects?|properties|options|homes?)\s+in\s+/i.test(text) ||
    (/\b(?:also|too|as well)\b/i.test(text) && /\b(?:in|near|around|at)\s+/i.test(text)) ||
    /\b(?:want|include|add|show|looking for).{0,40}\b(?:in|near|around)\s+/i.test(text)
  );
}

/** Strip trailing broaden words from a captured locality fragment. */
function cleanLocalityFragment(raw: string): string {
  return raw
    .trim()
    .replace(/[?!.,;:]+$/, '')
    .replace(/\s+(?:too|also|as well)\.?\s*$/i, '')
    .trim();
}

/** "coorg, 50L", "looking in Sakleshpur", bare locality. */
import { isAdvisorBriefChipPhrase } from './advisor-brief-chips.js';

export function extractLocation(text: string, ctx?: ExtractLocationContext): string | undefined {
  const trimmed = text.trim();
  if (ctx?.askTopics?.length) return undefined;
  if (isVisitDayUtterance(trimmed)) return undefined;
  if (
    /\b(?:keep|continue)\s+refining\b/i.test(trimmed) ||
    /\brefine(?:\s+(?:the|my))?\s+search\b/i.test(trimmed)
  ) {
    return undefined;
  }

  const GENERIC = /\b(properties|property|projects|options|plantation|homes|flats|apartments|villas)\b/i;

  const inTail = /\bin\s+(.+?)\s*$/i.exec(text.trim());
  if (inTail?.[1] && !GENERIC.test(inTail[1])) {
    return cleanLocalityFragment(inTail[1]);
  }

  const propsIn = /\b(?:properties|property|projects|options|homes)\s+in\s+([A-Za-z][A-Za-z\s]{2,20}?)(?:\s|$|[,.!?])/i.exec(
    text,
  );
  if (propsIn?.[1] && !GENERIC.test(propsIn[1])) {
    return cleanLocalityFragment(propsIn[1]);
  }

  const cityProjects = /^([A-Za-z][A-Za-z\s]{2,24}?)\s+projects?\b/i.exec(trimmed);
  if (
    cityProjects?.[1] &&
    !GENERIC.test(cityProjects[1]) &&
    !/\b(?:show|me|other|more|the|my|all|some|any|different|find|list|see)\b/i.test(cityProjects[1])
  ) {
    return cleanLocalityFragment(cityProjects[1]);
  }

  const commaLead = /^([A-Za-z][A-Za-z\s]{2,24}?)\s*,/i.exec(text.trim());
  if (commaLead?.[1] && !/\b(lakhs|crore|bhk|budget)\b/i.test(commaLead[1])) {
    return commaLead[1].trim();
  }
  const meinLoc = /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\b/i.exec(text);
  if (meinLoc?.[1] && !/\b(lakhs|crore|bhk|budget)\b/i.test(meinLoc[1])) {
    return meinLoc[1].trim();
  }
  const patterns = [
    /\b(?:looking|interested|searching)\s+(?:in|at|around|near|for)\s+([A-Za-z][A-Za-z\s]{2,24}?)(?:\s|$|[,.!?])/i,
    /\b(?:in|near|around|at)\s+([A-Za-z][A-Za-z\s]{2,24}?)(?:\s|$|[,.!?])/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] && !GENERIC.test(m[1]) && !/\b(lakhs|crore|bhk|budget)\b/i.test(m[1])) {
      return m[1].trim();
    }
  }
  const bare = text.trim();
  if (extractDayWord(bare)) return undefined;
  if (/\b(?:tell me about|more about|details? on|info on|about)\b/i.test(bare)) return undefined;
  if (ctx?.phase === 'focused' || ctx?.phase === 'visit') return undefined;
  if (
    /^[A-Za-z][A-Za-z\s/₹–\-+0-9]{2,32}$/.test(bare) &&
    bare.split(/\s+/).length <= 4 &&
    !/^(hi|hello|hey|yes|no|ok|thanks|pricing|legal|compare|location(?:\s+details?)?)$/i.test(bare) &&
    !/\b(?:compare|both|projects|options|show|visit|pricing|refining|refine|breakdown|costs?|details?|emi|overview|amenities|availability|brochure|floor plan)\b/i.test(bare) &&
    !isAdvisorBriefChipPhrase(bare)
  ) {
    return bare;
  }
  return undefined;
}

function detectDetailsPick(text: string, s: ConversationState): string | undefined {
  const m =
    /\b(?:details on|tell me about|more about|info on|show me details on|want full details on|full details on|give me (?:more )?details on|more details on)\s+([A-Za-z][A-Za-z0-9\s'-]{2,28}?)(?:\?|\.|!|$|\s+(?:please|project))/i.exec(
      text,
    );
  if (!m?.[1]) return undefined;
  const needle = m[1].trim().toLowerCase();
  // "details on the project" / "this project" — not a named pick
  if (/^(?:the|this)(?:\s+project)?$/i.test(needle)) return undefined;
  for (const o of s.discover.lastOffered) {
    const distinctive = o.name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
    if (needle.includes(distinctive) || distinctive.includes(needle)) return o.name;
  }
  if (s.focus && s.focus.projectName.toLowerCase().includes(needle)) return s.focus.projectName;
  return m[1].trim();
}

/** Bare shortlist reply after clarify — "Ayana", "Brigade Orchards", "Orchards". */
export function matchOfferedName(
  text: string,
  offered: readonly OfferedProject[],
): string | undefined {
  if (!offered.length) return undefined;
  const t = text.trim().toLowerCase().replace(/[?.!,]+$/g, '');
  if (!t || t.split(/\s+/).length > 6) return undefined;
  // Skip if clearly a facet/search ask, not a name pick
  if (
    /\b(?:plot sizes?|configurations?|pricing|legal|emi|visit|budget|compare|show me|looking)\b/i.test(t)
  ) {
    return undefined;
  }
  let best: { name: string; score: number } | undefined;
  for (const o of offered) {
    const name = o.name.toLowerCase();
    const distinctive = o.name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
    let score = 0;
    if (t === name || t === distinctive) score = 100;
    else if (name.startsWith(t) || distinctive.startsWith(t)) score = 80;
    else if (t.includes(name) || t.includes(distinctive)) score = 70;
    else if (name.includes(t) && t.length >= 4) score = 60;
    else if (distinctive.includes(t) && t.length >= 4) score = 55;
    if (score > 0 && (!best || score > best.score)) best = { name: o.name, score };
  }
  return best && best.score >= 55 ? best.name : undefined;
}
