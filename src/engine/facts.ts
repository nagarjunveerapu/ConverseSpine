/**
 * Fact extraction — deterministic closed-set + bounded LLM signals for open-set.
 * Surfaces facts only; never picks reply shape (phase machine owns goals).
 */
import type { EngineLlm } from './ports.js';
import type { IngressSlotKey } from './ingress.js';
import { isSlotWritable } from './ingress.js';
import type { ConversationState, Extracted, OfferedProject, AnswerTopic, ObjectionTopic, LocationCategoryKey } from './types.js';
import { extractDayWord, isVisitDayUtterance } from './visit-slot.js';
import { isAdvisorBriefChipPhrase } from './advisor-brief-chips.js';

/** Keep aligned with turn-intent AFFIRM_ONLY (dialogue acts, not localities). */
const AFFIRM =
  /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|haan?|haaji|theek(?:\s+hai)?|done|confirm(?:ed)?|go ahead|sounds good|perfect|great|yeah\s+sure|yes\s+please|ok\s+sure|sure\s+yes)\b/i;
/** Keep aligned with turn-intent DECLINE (dialogue acts, not localities). */
const DECLINE_UTTERANCE =
  /^(?:no|nope|nah|nahi(?:n)?(?:\s+chahiye)?|no\s+thanks|no\s+thank\s+you|not\s+now|not\s+interested|not\s+that|not\s+this|something\s+else)\.?!?\s*$/i;
const REJECT =
  /\b(?:not (?:that|this|those|these)|don'?t want|nahi(?:n)?\s+chahiye|too (?:far|expensive|costly|pricey|much|high)|skip (?:that|this)|nah|no,? not|something (?:else|cheaper))\b/i;
const NAME_RE = /\b(?:[Ii]\s*am|[Ii]'?m|[Mm]y name is|[Tt]his is|[Nn]ame'?s)\s+([A-Z][a-zA-Z]{1,30})\b/;
const WANTS_MORE_RE =
  /\b(?:other options?|show me (?:the )?(?:o?ptions?|otpions?|other projects?)|show options|more options?|more projects?|anything else|what else|see others?|alternatives?|options dikhao|list (?:the )?options?|some other)\b/i;
// Booking deixis only — bare "the visit" is visit_book (chip resolve), not recall (SA-2).
const VISIT_RECALL_RE =
  /\b(?:my|all) (?:site )?(?:visits?|bookings?)\b|visits? (?:i have )?(?:planned|booked|scheduled)/i;
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
    (DECLINE_UTTERANCE.test(t) ||
      /\b(?:no|nope|nah|nahi(?:n)?(?:\s+chahiye)?|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i.test(
        t,
      )) &&
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
    (DECLINE_UTTERANCE.test(t) ||
      /\b(?:no|nope|nah|nahi(?:n)?(?:\s+chahiye)?|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i.test(
        t,
      )) &&
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
  // A priority-probe answer ("Shorter commute") is a preference reply — the
  // location extractor must not eat it as a locality ("green near the hills"
  // bug class: un-understood text stuffed into the location slot).
  const softPrefs = detectSoftPrefs(text);
  if (
    !constraints.location &&
    !softPrefs.priorityFocus &&
    askTopic !== 'compare' &&
    !isVisitDayUtterance(text) &&
    isSlotWritable('location', filled, text)
  ) {
    constraints.location = extractLocation(text, locationExtractCtx(s, askTopics, text));
  }
  if (propertyTypeKw) constraints.propertyType = propertyTypeKw;
  if (purposeKw) constraints.purpose = purposeKw;
  Object.assign(constraints, softPrefs);

  const needLlm: Array<'location' | 'property_type' | 'purpose' | 'transition'> = [];
  if (
    !constraints.location &&
    !softPrefs.priorityFocus &&
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

  // Project identity ≠ locality (STY / dossier: "Meadows" must not become location_pref).
  if (constraints.location) {
    const locHints = [
      ...locationExtractCtx(s, askTopics, text).projectNameHints ?? [],
      ...namedProjects.map((p) => p.name),
      ...(pickName ? [pickName] : []),
    ];
    if (looksLikeOfferedProjectName(constraints.location, locHints)) {
      delete constraints.location;
    }
  }

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
  const softPrefsSync = detectSoftPrefs(text);
  const loc =
    !softPrefsSync.priorityFocus && isSlotWritable('location', filled, text)
      ? extractLocation(text, locationExtractCtx(s, askTopics, text))
      : undefined;
  if (loc) constraints.location = loc;
  const bhk = isSlotWritable('bhk', filled, text) ? extractConfigurationFilters(text) : undefined;
  if (bhk) constraints.bhk = bhk;
  const propertyType = isSlotWritable('propertyType', filled, text) ? detectPropertyTypes(text) : undefined;
  if (propertyType) constraints.propertyType = propertyType;
  const purpose = isSlotWritable('purpose', filled, text) ? detectPurpose(text) : undefined;
  if (purpose) constraints.purpose = purpose;
  Object.assign(constraints, softPrefsSync);
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

/** Distinctive tokens for shortlist identity ("Krishnaja Greens" → krishnaja, greens). */
function offeredNameTokens(name: string): string[] {
  const distinctive = name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
  const parts = distinctive.split(/\s+/).filter(Boolean);
  // Prefer tokens ≥4; keep a short final token (Neo, Ayana edge) when it is the
  // distinctive last word of a multi-word name.
  const tokens = parts.filter((t) => t.length >= 4);
  const last = parts[parts.length - 1];
  if (last && last.length >= 3 && last.length < 4 && !tokens.includes(last)) {
    tokens.push(last);
  }
  return tokens.length ? tokens : distinctive.length >= 3 ? [distinctive] : [];
}

function resolveNamed(text: string, s: ConversationState): OfferedProject[] {
  // Shortlist + discussed discourse — full catalog names still come from PROJECT_VECTORS.
  // Discussed lets "compare ayana and krishnaja" resolve when Krishnaja is not in lastOffered.
  const offered = s.discover.lastOffered;
  const discussed = s.discover.discussedProjects ?? [];
  const pool: OfferedProject[] = [...offered];
  for (const d of discussed) {
    if (!pool.some((p) => p.projectId === d.projectId)) pool.push(d);
  }
  if (!pool.length) return [];
  const t = text.trim().toLowerCase();
  const hits: OfferedProject[] = [];
  for (const o of pool) {
    const name = o.name.toLowerCase();
    const distinctive = o.name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
    const tokens = offeredNameTokens(o.name);
    if (
      t.includes(name) ||
      (distinctive.length >= 3 && t.includes(distinctive)) ||
      tokens.some((tok) => t.includes(tok))
    ) {
      hits.push(o);
    }
  }
  if (hits.length) return hits;
  const hit = matchOfferedName(text, pool);
  if (!hit) return [];
  const row = pool.find((o) => o.name === hit);
  return row ? [row] : [{ projectId: hit, name: hit }];
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
    // Family size / household count — not a price (STY-02: "family of 4" → ₹4L).
    .replace(/\b(?:family|household|group)\s+of\s+\d+\b/g, ' ')
    .replace(/\b\d+\s*(?:people|persons?|members?|adults?|kids?|children)\b/g, ' ')
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
  // Prefer unit-bearing / budget-anchored amounts over bare digits.
  const anchored = [
    ...s.matchAll(
      /(?:under|within|upto|up\s+to|below|budget(?:\s+is|\s+of)?|max(?:imum)?)\s+(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|cr|crores?)?/g,
    ),
  ];
  if (anchored.length) {
    const last = anchored[anchored.length - 1]!;
    const v = toInr(parseFloat(last[1]!), last[2] ?? '');
    if (v !== null && v > 0) return { max: v };
  }
  const withUnit = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l|cr|crores?)(?=\s|$|[^\w])/g)];
  if (withUnit.length) {
    const last = withUnit[withUnit.length - 1]!;
    const v = toInr(parseFloat(last[1]!), last[2] ?? '');
    if (v !== null && v > 0) return { max: v };
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

// Cost-sheet component vocabulary — the ONE source shared by the price topic
// pattern and the deterministic price-topic floor (extract-authority, W7).
// Unambiguous cost terms only: bare "registration" stays legal (RERA), bare
// "charges" stays the maintenance FAQ. Bare "tax(es)" is deliberately excluded —
// it steals FAQ-shaped asks ("property tax?", "tax benefit?") — so taxes ground
// only via a cost neighbour ("charges and taxes"); GST/cess are cost-specific.
const COST_COMPONENT_SRC =
  'stamp\\s*duty|registration\\s+(?:charges?|fees?|cost)|(?:total|all|other|additional|extra)\\s+charges?(?:\\s+(?:and\\s+)?taxes?)?|gst|cess|cost\\s+sheet';
const COST_COMPONENT_RE = new RegExp(`\\b(?:${COST_COMPONENT_SRC})\\b`, 'i');

/** A cost-sheet component ask (stamp duty, registration charges, GST, …). */
export function isCostComponentAsk(text: string): boolean {
  return COST_COMPONENT_RE.test(text);
}

const TOPIC_PATTERNS: ReadonlyArray<{ topic: AnswerTopic; re: RegExp }> = [
  { topic: 'compare', re: /\b(?:compare|vs|versus|side by side|difference between|both projects?)\b/i },
  {
    // Cost-sheet components (stamp duty, registration charges, taxes) are price
    // asks — they must route to the pricing evidence, not fall to no_fit (W7).
    topic: 'price',
    re: new RegExp(
      `\\b(?:prices?|pricing|cost|how much|pricing batao|kitna|padega|bsp|basic\\s+sale\\s+price|carpet(?:\\s+area)?|sba|super\\s+built[- ]?up|landed cost|all[- ]in cost|price break[- ]?up|breakdown|component[- ]wise|starting\\s+prices?|${COST_COMPONENT_SRC})\\b`,
      'i',
    ),
  },
  {
    topic: 'legal',
    // Loan eligibility / banks stay legal+FAQ — not EMI calculator.
    re: /\b(?:rera|legal|khata|title|approval|documents?|paperwork|paper\s*work|legal status|legal details|clear title|title clear|\bec\b|encumbrance(?: certificate)?|(?:which|what)\s+banks?|banks?\s+(?:approved|approv|approving)|approved\s+banks?|home\s+loan(?:\s+approv|\s+eligib)?|(?:can\s+i\s+(?:get|take)\s+(?:a\s+)?(?:home\s+)?loan)|loan\s+eligib|is\s+(?:the\s+)?ec\s+clear)\b/i,
  },
  {
    topic: 'property_type',
    re: /\b(?:is this (?:a |an )?(?:apartment|plot|villa|flat|plantation)|is it (?:a |an )?(?:apartment|plot|villa|flat)|(?:apartment|plot|villa|flat)s?\s+or\s+(?:apartment|plot|villa|flat)s?|what type of (?:property|project)|property type|what kind of (?:property|project))\b/i,
  },
  {
    // Asking about a project's location/connectivity — not "schools nearby" soft amenity.
    topic: 'location',
    re: /\b(?:location details?|where(?:'s| is)(?: it| this)?\s*\?|connectivity|distance|how far|map|directions?|micro[- ]?market)\b|^location\s*\?$/i,
  },
  // EMI amount / installment only — bare "loan" / "home loan" is legal+FAQ above.
  { topic: 'emi', re: /\b(?:\bemi\b|monthly\s+payment|installment|loan\s+emi|emi\s+(?:kitna|amount|calc(?:ulate)?))\b/i },
  { topic: 'amenities', re: /\b(?:amenit|facilit|clubhouse|pool|gym)\b/i },
  {
    // Config / unit asks only. Preference "ready to move" is a Constraint soft pref
    // (detectSoftPrefs) — never askTopics:availability on search briefs.
    // Focused readiness asks: "is it ready", "when … ready".
    topic: 'availability',
    re: /\b(?:is\s+(?:it|this)\s+ready(?:\s+to\s+move)?|when(?:'s| is)?(?:\s+it)?\s+ready|available|units?|configurations?|configs?|bhk options?|plot\s+sizes?|unit\s+sizes?|unit\s+configurations?|sizes?\s+offered|sq\.?\s*ft\s+(?:options?|sizes?)|what\s+(?:sizes?|configs?|configurations?)\b|(?:\d+(?:\.\d+)?\s*)?bhk\s+(?:configs?|configurations?|options?|sizes?)|(?:any|what)\s+(?:\d+(?:\.\d+)?\s*)?bhk\s+options?(?:\s+left)?|options?\s+left)\b/i,
  },
  {
    topic: 'media',
    re: /\b(?:brochure|floor plan|layout|video|photos?|images?|pdf|share (?:the )?(?:brochure|plan)|(?:brochure|floor\s*plan|layout|pdf|photos?)\s*(?:bhejo|bhej|bhejna|bhej\s*do)|(?:bhejo|bhej)\s*(?:brochure|pdf|photos?|floor\s*plan)?)\b/i,
  },
];

/** All answer topics mentioned this turn (multi-intent). */
export function detectTopics(text: string): AnswerTopic[] {
  const found = new Set<AnswerTopic>();
  for (const { topic, re } of TOPIC_PATTERNS) {
    if (re.test(text)) found.add(topic);
  }
  return TOPIC_ORDER.filter((t) => found.has(t));
}

/** Soft prefs on Constraints — not answer topics / not Desk search_text. */
export function detectSoftPrefs(
  text: string,
): Pick<
  Extracted['constraints'],
  'readyToMove' | 'nearAirport' | 'commuteHub' | 'priorityFocus' | 'schoolsMentioned' | 'walkabilityMentioned' | 'valueMentioned'
> {
  const out: Pick<
    Extracted['constraints'],
    'readyToMove' | 'nearAirport' | 'commuteHub' | 'priorityFocus' | 'schoolsMentioned' | 'walkabilityMentioned' | 'valueMentioned'
  > = {};
  if (/\bready\s+to\s+move\b|\bpreferably\s+ready\b/i.test(text)) out.readyToMove = true;
  if (/\bnear(?:\s+the)?\s+airport\b|\bairport\s+(?:side|corridor|road)\b/i.test(text)) {
    out.nearAirport = true;
  }
  // Trade-off Advisor soft signals — deterministic phrasings only (chip texts
  // + common free-text forms). Anything fuzzier belongs to L4 gap-fill.
  if (/\bshorter\s+commute\b|\bcommute\s+(?:matters|first|is\s+(?:key|top))\b/i.test(text)) {
    out.priorityFocus = 'commute';
  } else if (/\bstay(?:ing)?\s+(?:on|under|within)\s+budget\b|\bbudget\s+(?:matters|first|is\s+(?:key|top))\b/i.test(text)) {
    out.priorityFocus = 'budget';
  } else if (/\babout\s+equal\b|\bboth\s+matter\b|\bbalanced\b/i.test(text)) {
    out.priorityFocus = 'balanced';
  }
  // Hub names are capitalized ("ITPL", "Electronic City") — capture a run of
  // capital-initial words so trailing adverbs ("daily") never leak in.
  const HUB_NAME = /([A-Z][A-Za-z0-9.&-]*(?:\s+[A-Z][A-Za-z0-9.&-]*){0,3})/;
  const hub = text.match(new RegExp(String.raw`\b(?:work(?:ing)?|office)\s+(?:is\s+)?(?:at|in|near)\s+` + HUB_NAME.source))
    ?? text.match(new RegExp(String.raw`\bcommut(?:e|ing)\s+to\s+` + HUB_NAME.source));
  if (hub?.[1]) out.commuteHub = hub[1].trim();
  if (/\bgood\s+schools?\b|\bschools?\s+near(?:by)?\b|\bkids?['\u2019]?s?\s+school\b/i.test(text)) {
    out.schoolsMentioned = true;
  }
  if (/\bwalk(?:able|ability)\b|\bwalking\s+distance\b|\beverything\s+within\s+walk/i.test(text)) {
    out.walkabilityMentioned = true;
  }
  if (/\bresale\b|\bappreciat(?:e|ion)\b|\bhold(?:s)?\s+(?:its\s+)?value\b|\bfuture\s+value\b/i.test(text)) {
    out.valueMentioned = true;
  }
  return out;
}

/** Search-shaped free text — location extract must not die on soft-pref noise. */
export function looksLikeSearchBriefText(text: string): boolean {
  return (
    /\b(?:in|near|around|at)\s+[A-Za-z]/i.test(text) ||
    /\b(?:plantation|villa|apartment|plot|flat|bhk|budget|crore|lakh)\b/i.test(text)
  );
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
  /** Shortlist + focus names — "in Eldorado" is a project ref, not a locality. */
  projectNameHints?: readonly string[];
};

function projectNameHints(s: ConversationState): string[] {
  const names = s.discover.lastOffered.map((o) => o.name);
  for (const d of s.discover.discussedProjects ?? []) names.push(d.name);
  if (s.focus?.projectName) names.push(s.focus.projectName);
  return names;
}

function locationExtractCtx(
  s: ConversationState,
  askTopics: AnswerTopic[],
  text?: string,
): ExtractLocationContext {
  // Soft-pref / search briefs: availability alone must not block locality extract.
  let topics = askTopics;
  if (
    text &&
    looksLikeSearchBriefText(text) &&
    topics.length > 0 &&
    topics.every((t) => t === 'availability')
  ) {
    topics = [];
  }
  return {
    phase: s.phase,
    askTopics: topics,
    projectNameHints: projectNameHints(s),
  };
}

/** True when fragment looks like a known project name (shortlist / focus). */
export function looksLikeOfferedProjectName(
  fragment: string,
  hints: readonly string[] | undefined,
): boolean {
  if (!hints?.length) return false;
  const needle = fragment.trim().toLowerCase().replace(/^(brigade|lokations)\s+/i, '');
  if (needle.length < 3) return false;
  for (const raw of hints) {
    const name = raw.toLowerCase();
    const distinctive = name.replace(/^(brigade|lokations)\s+/i, '');
    if (
      needle === distinctive ||
      distinctive.includes(needle) ||
      needle.includes(distinctive) ||
      name.includes(needle)
    ) {
      return true;
    }
  }
  return false;
}

export function isLocationBroadenTurn(text: string): boolean {
  return (
    /\b(?:projects?|properties|options|homes?)\s+in\s+/i.test(text) ||
    (/\b(?:also|too|as well)\b/i.test(text) && /\b(?:in|near|around|at)\s+/i.test(text)) ||
    /\b(?:want|include|add|show|looking for).{0,40}\b(?:in|near|around)\s+/i.test(text)
  );
}

/**
 * S1 — which LI POI categories the buyer is asking about ("schools near X",
 * "how far is the metro"). Order matters: itParks is tested before parks and
 * wins when both match, so "IT parks nearby" never reads as green parks.
 * Evidence assembly leads with these categories.
 */
const LOCATION_CATEGORY_TERMS: ReadonlyArray<[LocationCategoryKey, RegExp]> = [
  ['schools', /\b(?:schools?|preschools?|kindergartens?)\b/i],
  ['hospitals', /\b(?:hospitals?|clinics?|medical\s+(?:care|facilit))/i],
  ['metroStations', /\b(?:metro|namma)\b/i],
  ['airports', /\bairport\b/i],
  ['itParks', /\b(?:it\s+parks?|tech\s+parks?|itpl|office\s+hubs?)\b/i],
  ['malls', /\b(?:malls?|shopping)\b/i],
  ['universities', /\b(?:universit(?:y|ies)|colleges?)\b/i],
  ['supermarkets', /\b(?:supermarkets?|grocer(?:y|ies))\b/i],
  ['transitStations', /\b(?:railway|train|bus\s+(?:stop|station|depot))\b/i],
  ['parks', /\bparks?\b/i],
];

export function locationCategoriesAsked(text: string): LocationCategoryKey[] {
  const t = text.trim();
  if (!t) return [];
  const out: LocationCategoryKey[] = [];
  for (const [key, re] of LOCATION_CATEGORY_TERMS) {
    if (re.test(t)) out.push(key);
  }
  // "IT park / tech park" phrasing matches the generic parks term too — only
  // count green parks when the buyer clearly means them.
  if (out.includes('itParks') && out.includes('parks') && !/\b(?:green|children|play)\b/i.test(t)) {
    return out.filter((k) => k !== 'parks');
  }
  return out;
}

/** "wait I meant Whitefield not Devanahalli" — correction, not project switch (PIV-02). */
export function isLocationCorrectionTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(?:i\s+)?meant\b.+\bnot\b/i.test(t) ||
    /\bnot\s+[A-Za-z][\w\s-]{2,30}\s*[,—-]?\s*(?:i\s+)?meant\b/i.test(t) ||
    /\b(?:wrong|change(?:d)?)\s+(?:area|location|locality|micro[- ]?market)\b/i.test(t) ||
    /\b(?:looking|want|prefer)\s+(?:in|at|near)\s+[A-Za-z].{0,20}\bnot\b/i.test(t)
  );
}

/** Mid-list BHK/budget/location refine — re-search, don't clarify pick (PIV-03). */
export function isConstraintRefinementTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    !/\b(?:change|switch|update|actually|instead|rather|refine|adjust|make\s+it|now)\b/i.test(t)
  ) {
    return false;
  }
  return Boolean(
    parseBudgetToInr(t) ||
      /\b\d(?:\.\d)?\s*bhk\b/i.test(t) ||
      extractLocation(t) ||
      detectPropertyTypes(t),
  );
}

/** Strip trailing broaden words from a captured locality fragment. */
function cleanLocalityFragment(raw: string): string {
  return raw
    .trim()
    .replace(/[?!.,;:]+$/, '')
    .replace(/\s+(?:too|also|as well)\.?\s*$/i, '')
    // Budget / BHK glued by greedy `in …` capture — not part of locality.
    .replace(
      /\s+(?:under|below|above|upto|up\s+to|around|about|within)\s+[\d.,]+\s*(?:cr|crore|crs|lakh|lakhs|lacs?|l)\b.*$/i,
      '',
    )
    .replace(/\s+(?:under|below|above)\s+[\d.,]+\s*(?:crore|cr|lakh|lakhs|lacs?)\b.*$/i, '')
    .replace(/\s+(?:preferably|\d(?:\.\d)?\s*bhk|preferably|ready\s+to\s+move|near\s+airport).*$/i, '')
    .trim();
}

/**
 * True when regex "location" still carries budget/config noise
 * ("North Bangalore under 1.5 Cr") — treat as empty so embedder/BAML can own free text.
 */
export function locationLooksPolluted(loc: string | undefined): boolean {
  if (!loc) return false;
  const lc = loc.toLowerCase().trim();
  if (!lc) return false;
  if (lc.split(/\s+/).length > 6) return true;
  return /\b(?:under|below|above|upto|up\s+to|budget|crore|crs?\b|lakh|lakhs|lacs?|\d+\s*(?:cr|l)\b|\d(?:\.\d)?\s*bhk|preferably|ready\s+to\s+move)\b/i.test(
    lc,
  );
}

/** "coorg, 50L", "looking in Sakleshpur", bare locality. */
export function extractLocation(text: string, ctx?: ExtractLocationContext): string | undefined {
  const trimmed = text.trim();
  if (ctx?.askTopics?.length) return undefined;
  if (isVisitDayUtterance(trimmed)) return undefined;
  // Dialogue acts — never invent a locality (HIN-06: "nahi chahiye" ≠ place).
  if (DECLINE_UTTERANCE.test(trimmed) || AFFIRM.test(trimmed)) return undefined;
  // Project re-focus / switch — not a locality (W1: "back to Ayana").
  if (/\bback\s+to\b/i.test(trimmed)) return undefined;
  if (
    /\b(?:keep|continue)\s+refining\b/i.test(trimmed) ||
    /\brefine(?:\s+(?:the|my))?\s+search\b/i.test(trimmed)
  ) {
    return undefined;
  }

  const GENERIC = /\b(properties|property|projects|options|plantation|homes|flats|apartments|villas)\b/i;
  const hints = ctx?.projectNameHints;

  const acceptLocality = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    const cleaned = cleanLocalityFragment(raw);
    if (!cleaned || GENERIC.test(cleaned)) return undefined;
    if (looksLikeOfferedProjectName(cleaned, hints)) return undefined;
    return cleaned;
  };

  // "I meant Whitefield not Devanahalli" — take the corrected locality.
  const meantNot = /\b(?:i\s+)?meant\s+([A-Za-z][A-Za-z\s-]{2,40}?)\s+not\b/i.exec(trimmed);
  if (meantNot?.[1]) {
    const loc = acceptLocality(meantNot[1]);
    if (loc) return loc;
  }
  const notMeant = /\bnot\s+[A-Za-z][\w\s-]{2,30}\s*[,—-]?\s*(?:i\s+)?meant\s+([A-Za-z][A-Za-z\s-]{2,40})/i.exec(
    trimmed,
  );
  if (notMeant?.[1]) {
    const loc = acceptLocality(notMeant[1]);
    if (loc) return loc;
  }

  const inTail = /\bin\s+(.+?)\s*$/i.exec(text.trim());
  if (inTail?.[1]) {
    const loc = acceptLocality(inTail[1]);
    if (loc) return loc;
  }

  const propsIn = /\b(?:properties|property|projects|options|homes)\s+in\s+([A-Za-z][A-Za-z\s]{2,20}?)(?:\s|$|[,.!?])/i.exec(
    text,
  );
  if (propsIn?.[1]) {
    const loc = acceptLocality(propsIn[1]);
    if (loc) return loc;
  }

  const cityProjects = /^([A-Za-z][A-Za-z\s]{2,24}?)\s+projects?\b/i.exec(trimmed);
  if (
    cityProjects?.[1] &&
    !GENERIC.test(cityProjects[1]) &&
    !/\b(?:show|me|other|more|the|my|all|some|any|different|find|list|see)\b/i.test(cityProjects[1])
  ) {
    const loc = acceptLocality(cityProjects[1]);
    if (loc) return loc;
  }

  const commaLead = /^([A-Za-z][A-Za-z\s]{2,24}?)\s*,/i.exec(text.trim());
  if (commaLead?.[1] && !/\b(lakhs|crore|bhk|budget)\b/i.test(commaLead[1])) {
    const loc = acceptLocality(commaLead[1]);
    if (loc) return loc;
  }
  const meinLoc = /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\b/i.exec(text);
  if (meinLoc?.[1] && !/\b(lakhs|crore|bhk|budget)\b/i.test(meinLoc[1])) {
    const loc = acceptLocality(meinLoc[1]);
    if (loc) return loc;
  }
  const patterns = [
    /\b(?:looking|interested|searching)\s+(?:in|at|around|near|for)\s+([A-Za-z][A-Za-z\s]{2,24}?)(?:\s|$|[,.!?])/i,
    /\b(?:in|near|around|at)\s+([A-Za-z][A-Za-z\s]{2,24}?)(?:\s|$|[,.!?])/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] && !GENERIC.test(m[1]) && !/\b(lakhs|crore|bhk|budget)\b/i.test(m[1])) {
      const loc = acceptLocality(m[1]);
      if (loc) return loc;
    }
  }
  const bare = text.trim();
  if (extractDayWord(bare)) return undefined;
  if (/\b(?:tell me about|more about|details? on|info on|about)\b/i.test(bare)) return undefined;
  if (ctx?.phase === 'focused' || ctx?.phase === 'visit') return undefined;
  if (
    /^[A-Za-z][A-Za-z\s/₹–\-+0-9]{2,32}$/.test(bare) &&
    bare.split(/\s+/).length <= 4 &&
    !/^(hi|hello|hey|yes|no|ok|thanks|pricing|legal|compare|location(?:\s+details?)?|haan?|haaji|yeah\s+sure|yes\s+please|nahi(?:n)?(?:\s+chahiye)?)$/i.test(
      bare,
    ) &&
    !/\b(?:compare|both|dono|projects|options|show|visit|pricing|refining|refine|breakdown|costs?|details?|emi|overview|amenities|availability|brochure|floor plan|chahiye)\b/i.test(bare) &&
    !isAdvisorBriefChipPhrase(bare) &&
    !looksLikeOfferedProjectName(bare, hints) &&
    !AFFIRM.test(bare) &&
    !DECLINE_UTTERANCE.test(bare)
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

/**
 * Closed config/unit lexicon for chip-miss bridges (not chip free-text sprawl).
 * Must match "options" / "2BHK" — word-boundary on bare `option`/`bhk` misses those.
 */
export function looksLikeConfigAsk(text: string): boolean {
  return /(?:options?|configs?(?:urations?)?|units?|sizes?|available|(?:\d+(?:\.\d+)?\s*)?bhk|sq\.?\s*ft|sqft)/i.test(
    text,
  );
}

/** Bare shortlist reply after clarify — "Ayana", "Brigade Orchards", "Orchards". */
export function matchOfferedName(
  text: string,
  offered: readonly OfferedProject[],
): string | undefined {
  if (!offered.length) return undefined;
  const t = text.trim().toLowerCase().replace(/[?.!,]+$/g, '');
  if (!t) return undefined;
  const wordCount = t.split(/\s+/).length;
  const hasEmbeddedName = offered.some((o) => {
    const distinctive = o.name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
    const tokens = offeredNameTokens(o.name);
    return (
      (distinctive.length >= 4 && t.includes(distinctive)) ||
      tokens.some((tok) => t.includes(tok))
    );
  });
  // Short bare picks only when no shortlist token is embedded (avoids "looking in Whitefield").
  if (!hasEmbeddedName && wordCount > 6) return undefined;
  // Skip facet-only asks unless a shortlist name is already in the utterance.
  if (
    !hasEmbeddedName &&
    /\b(?:plot sizes?|configurations?|pricing|legal|emi|visit|budget|compare|show me|looking)\b/i.test(t)
  ) {
    return undefined;
  }
  let best: { name: string; score: number } | undefined;
  for (const o of offered) {
    const name = o.name.toLowerCase();
    const distinctive = o.name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
    const tokens = offeredNameTokens(o.name);
    let score = 0;
    if (t === name || t === distinctive) score = 100;
    else if (name.startsWith(t) || distinctive.startsWith(t)) score = 80;
    else if (t.includes(name) || t.includes(distinctive)) score = 70;
    else if (tokens.some((tok) => t.includes(tok))) score = 68;
    else if (!hasEmbeddedName && name.includes(t) && t.length >= 3) score = 60;
    else if (!hasEmbeddedName && distinctive.includes(t) && t.length >= 3) score = 55;
    else if (
      !hasEmbeddedName &&
      wordCount === 1 &&
      t.length >= 3 &&
      distinctive.split(/\s+/).pop() === t
    ) {
      score = 58; // bare "Neo" → Brigade Northridge Neo
    }
    if (score > 0 && (!best || score > best.score)) best = { name: o.name, score };
  }
  return best && best.score >= 55 ? best.name : undefined;
}
