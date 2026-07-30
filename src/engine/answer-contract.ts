import type { Failure } from './outcome.js';
import { hasAppreciation, hasInvestmentRoi, hasRentBands } from './market-intel.js';
import type { AnswerTopic, EvidenceSet, FactKey, TurnGoal } from './types.js';

const REQUIREMENT_PATTERNS: ReadonlyArray<{ key: FactKey; pattern: RegExp }> = [
  { key: 'carpet_area', pattern: /\bcarpet\s+(?:area|size)\b/i },
  { key: 'built_up_area', pattern: /\b(?:built[- ]?up|super\s+built[- ]?up|sba)\s*(?:area|size)?\b/i },
  { key: 'possession', pattern: /\b(?:possession|handover)(?:\s+(?:date|timeline|when))?\b/i },
  // Focused menu chip — bare "when" means possession on the open project.
  { key: 'possession', pattern: /^when\s*[?.!]?\s*$/i },
  { key: 'rera', pattern: /\brera(?:\s+(?:number|status|registration))?\b/i },
  { key: 'khata', pattern: /\bkhata\b/i },
  { key: 'ec_status', pattern: /\b(?:ec|encumbrance)\s+(?:status|certificate|clear)?\b/i },
  { key: 'loan_eligibility', pattern: /\b(?:home\s+loan|loan\s+eligibility|approved\s+banks?|which\s+banks?)\b/i },
  // Natural + chip loan asks (including trailing ?). Must beat brochure embedder binds.
  {
    key: 'loan_eligibility',
    pattern:
      /^(?:loans?)\s*[?.!]?\s*$|\b(?:(?:can|could|may|will)\s+(?:i|we)\s+(?:get|avail|take)\s+(?:a\s+|the\s+)?loan|(?:get|avail|take)\s+(?:a\s+|the\s+)?loan(?:\s+for|\s+on)?|eligible\s+for\s+(?:a\s+|the\s+)?loan|loan\s+(?:eligib|approv|availab|for\s+this|on\s+this|against)|bank\s+loan|housing\s+loan|\bltv\b)\b|\bloans?\s*[?.!]/i,
  },
  // P2 residual: Hinglish loan + "is banks available" (not inventory).
  {
    key: 'loan_eligibility',
    pattern:
      /\b(?:loan\s+mil(?:e(?:ga|gi)?)?|ispe\s+loan|loan\s+ho\s+jayega|banks?\s+available|is\s+banks?\s+available|can\s+i\s+get\s+(?:banks?|approvals?)|get\s+banks?\s+for|what\s+about\s+(?:banks?|loans?|approvals?)|approvals?\s+for\s+this|(?:tell\s+me\s+about|need)\s+(?:banks?|loan(?:\s+details)?|loan\s+eligibility)|about\s+banks?)\b|\bapprovals?\b/i,
  },
  { key: 'project_type', pattern: /\b(?:property|project)\s+type\b/i },
  { key: 'price', pattern: /\b(?:price|pricing|starting\s+price|how\s+much)\b/i },
  // Focused chip + free-text negotiate ("any discount on this", "best price?").
  {
    key: 'price',
    pattern:
      /^(?:discounts?|offers?|best\s+price)\s*[?.!]?\s*$|\b(?:any\s+)?(?:best\s+)?(?:price|discount|offer)s?\s+(?:on\s+this|for\s+this)|(?:any|best)\s+(?:price|discount|offer)s?\b/i,
  },
  { key: 'flood_zone', pattern: /\b(?:flood|flooding|flood[- ]?zone)\b/i },
  // Advisory atoms — deliver when approved market intel / project ROI is on
  // detail; otherwise no_data (C1: never invent a %).
  { key: 'rental_yield', pattern: /\b(?:rental\s+yield|yield|roi|return\s+on\s+investment|rental\s+returns?|rental\s+income)\b/i },
  // Bare "returns?" / "what returns can I expect" — P2 residual investment atom.
  {
    key: 'rental_yield',
    pattern:
      /^(?:returns?)\s*[?.!]?\s*$|\b(?:what\s+returns?(?:\s+can\s+i\s+expect)?|returns?\s+can\s+i\s+expect|about\s+returns?)\b|\breturns?\s*[?.!]/i,
  },
  // Include resale / capital-gains phrasing — P2 multis often say "resale value?"
  // without "appreciation", so requires never fired and price-only compose won.
  {
    // Devanagari must not sit inside `\b…\b` — JS word boundaries are ASCII-only,
    // so `एप्रिसिएशन` never matched.
    key: 'appreciation',
    pattern:
      /\b(?:appreciat\w*|resale(?:\s+value)?|capital\s+gains?|how\s+much\s+has\s+(?:this\s+)?(?:area|corridor)\s+grown|corridor\s+growth)\b|एप्रिसिएशन/i,
  },
  {
    key: 'growth_drivers',
    pattern:
      /\b(?:what(?:'s|\s+is)\s+driving|growth\s+drivers?|why\s+is\s+(?:this\s+)?(?:area|corridor)\s+growing|infra(?:structure)?\s+(?:pipeline|coming)|upcoming\s+(?:metro|airport|ring\s*road))\b/i,
  },
  {
    key: 'operator_model',
    pattern:
      /\b(?:operator|who\s+operates|revenue\s+model|maintenance\s+model|managed\s+(?:lease|asset|resort))\b/i,
  },
  {
    key: 'visit_logistics',
    pattern:
      /\b(?:pickup|parking\s+on\s+site|site\s+visit\s+hours|food\s+on\s+(?:site|visit)|accommodation\s+(?:on\s+)?(?:site|visit)|do\s+you\s+arrange\s+pickup)\b/i,
  },
];

export function answerRequirements(text: string): FactKey[] {
  return REQUIREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ key }) => key);
}

/** FactKeys owned by an AnswerTopic — used to drop parked-topic requires. */
const FACT_KEY_TOPIC: Partial<Record<FactKey, AnswerTopic>> = {
  carpet_area: 'price',
  built_up_area: 'price',
  price: 'price',
  possession: 'availability',
  rera: 'legal',
  khata: 'legal',
  ec_status: 'legal',
  loan_eligibility: 'legal',
  project_type: 'property_type',
  appreciation: 'overview',
  rental_yield: 'overview',
  growth_drivers: 'overview',
};

export function withAnswerRequirements(
  goal: Extract<TurnGoal, { kind: 'answer' }>,
  text: string,
): Extract<TurnGoal, { kind: 'answer' }> {
  const parked = new Set(goal.parkedTopics ?? []);
  const requires = answerRequirements(text).filter((key) => {
    const topic = FACT_KEY_TOPIC[key];
    return !topic || !parked.has(topic);
  });
  if (!requires.length) return goal;

  // Brochure/media embedder misbinds must not outrank a FactKey loan ask.
  let next: Extract<TurnGoal, { kind: 'answer' }> = { ...goal, requires };
  if (requires.includes('loan_eligibility')) {
    const topics = (goal.topics?.length ? goal.topics : [goal.topic]).filter((t) => t !== 'media');
    const withLegal = topics.includes('legal') ? topics : (['legal', ...topics] as AnswerTopic[]);
    next = {
      ...next,
      topic: 'legal',
      ...(withLegal.length > 1 ? { topics: withLegal } : { topics: undefined }),
    };
  }
  // P2 residual: appreciation/resale co-asked with price — keep overview in the
  // multi set so advisory/honest-miss is not swallowed by the pricing template.
  if (
    (requires.includes('appreciation') || requires.includes('rental_yield')) &&
    !requires.includes('loan_eligibility')
  ) {
    const topics = next.topics?.length ? [...next.topics] : [next.topic];
    if (!topics.includes('overview')) {
      const withOverview = [...topics, 'overview'] as AnswerTopic[];
      next = {
        ...next,
        ...(withOverview.length > 1 ? { topics: withOverview } : {}),
      };
    }
  }
  return next;
}

export function deliveredFactKeys(evidence: EvidenceSet): FactKey[] {
  const delivered: FactKey[] = [];
  const faqKeys = new Set(
    evidence.detail?.faqs?.map((faq) => faq.questionKey.toLowerCase()) ?? [],
  );
  if (
    evidence.detail?.possession ||
    faqKeys.has('possession') ||
    faqKeys.has('ready_to_move')
  ) {
    delivered.push('possession');
  }
  if (
    evidence.detail?.reraNumber ||
    faqKeys.has('rera_status') ||
    faqKeys.has('rera_number')
  ) {
    delivered.push('rera');
  }
  if (evidence.detail?.khata || faqKeys.has('khata')) delivered.push('khata');
  if (evidence.detail?.ecStatus || faqKeys.has('ec_status')) delivered.push('ec_status');
  if (
    evidence.detail?.loanEligibility ||
    faqKeys.has('loan_eligibility') ||
    faqKeys.has('loan') ||
    faqKeys.has('banks')
  ) {
    delivered.push('loan_eligibility');
  }
  if (evidence.detail?.projectType) delivered.push('project_type');
  // Price is delivered by a live pricing quote OR by config prices already on
  // the detail (incl. the resilient projectCache fallback) — so a flaked
  // pricingQuote can't produce a false "I don't have price on file" when the
  // detail we hold carries the config prices.
  if (
    evidence.pricing ||
    evidence.landedCost ||
    evidence.detail?.configurations?.some((c) => (c.priceMinInr ?? 0) > 0)
  ) {
    delivered.push('price');
  }
  // CRM activation — deliver yield/ROI only from gated market intel or the
  // project ROI atom. Never from FAQ/education copy (that was the C1 leak).
  if (hasRentBands(evidence.detail?.marketIntel) || hasInvestmentRoi(evidence.detail?.investment)) {
    delivered.push('rental_yield');
  }
  if (hasAppreciation(evidence.detail?.marketIntel)) {
    delivered.push('appreciation');
  }
  if ((evidence.detail?.marketIntel?.drivers.length ?? 0) > 0) {
    delivered.push('growth_drivers');
  }
  const inv = evidence.detail?.investment;
  if (inv?.operatorBrand || inv?.revenueModel || inv?.maintenanceModel || inv?.guaranteedPayment) {
    delivered.push('operator_model');
  }
  const visit = evidence.detail?.visitLogistics;
  if (
    visit &&
    (visit.pickupMode ||
      visit.parkingOnSite ||
      visit.foodOffered ||
      visit.accommodationOffered ||
      visit.siteVisitHours)
  ) {
    delivered.push('visit_logistics');
  }
  return delivered;
}

function missingFactFailure(subject: FactKey): Failure {
  return {
    kind: 'no_data',
    stage: 'compose',
    subject,
  };
}

/**
 * Verify delivery before compose. A partial answer keeps supported evidence and
 * carries notices; a turn with none of its required atoms becomes terminal.
 */
export function enforceAnswerContract(
  goal: Extract<TurnGoal, { kind: 'answer' }>,
  evidence: EvidenceSet,
): EvidenceSet {
  if (!goal.requires?.length) return evidence;
  const deliveredFacts = deliveredFactKeys(evidence);
  const delivered = new Set(deliveredFacts);
  const missing = goal.requires.filter((key) => !delivered.has(key));
  if (!missing.length) return { ...evidence, deliveredFacts };

  const failures = missing.map(missingFactFailure);
  const deliveredRequired = goal.requires.filter((key) => delivered.has(key));
  if (!deliveredRequired.length) {
    return {
      ...evidence,
      deliveredFacts,
      failure: failures[0],
      ...(failures.length > 1 ? { notices: failures.slice(1) } : {}),
    };
  }
  return {
    ...evidence,
    deliveredFacts,
    notices: failures,
  };
}
