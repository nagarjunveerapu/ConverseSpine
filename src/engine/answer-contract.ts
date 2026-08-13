import type { Failure } from './outcome.js';
import { hasAppreciation, hasInvestmentRoi, hasRentBands } from './market-intel.js';
import type { AnswerTopic, EvidenceSet, FactKey, TurnGoal } from './types.js';

const REQUIREMENT_PATTERNS: ReadonlyArray<{ key: FactKey; pattern: RegExp }> = [
  // "is 1400 sqft carpet or super built up?" — the buyer says the word bare, so
  // requiring "carpet AREA" made the commonest form of the question invisible.
  { key: 'carpet_area', pattern: /\bcarpet\b/i },
  { key: 'built_up_area', pattern: /\b(?:built[- ]?up|super\s+built[- ]?up|sba)\s*(?:area|size)?\b/i },
  // The statutory add-ons the buyer budgets for separately. Answered from the
  // cost sheet's one-time charges — never estimated, since the rate is a state
  // rule we do not hold.
  // "Are there any hidden charges?" — the distrust question. It asks for the
  // statutory and one-time heads by another name, so it takes the same key: the
  // cost sheet is the answer, and topic routing follows the key.
  {
    key: 'stamp_duty',
    pattern:
      /\b(?:hidden|extra|additional|other|further|surprise)\s+(?:charges?|costs?|fees?|payments?)\b|\bwhat\s+else\s+(?:do|will)\s+i\s+(?:pay|have to pay)\b|\bover and above\b/i,
  },
  {
    key: 'stamp_duty',
    pattern:
      /\b(?:stamp\s*duty|registration\s+(?:charges?|fees?|cost)|reg(?:n|istration)?\s*charges?|khata\s+(?:charges?|fees?)|gst\b|statutory\s+charges?)\b/i,
  },
  // The comparable rate. "per sqft", "rate per square feet", "psf".
  {
    key: 'price_per_sqft',
    pattern:
      /\b(?:per\s*(?:sq\.?\s*ft|sqft|square\s*(?:feet|foot)|sft)|(?:sq\.?\s*ft|sqft|sft)\s*rate|psf|rate\s+per\s+(?:sq\.?\s*ft|sqft|square\s*(?:feet|foot)))\b/i,
  },
  { key: 'possession', pattern: /\b(?:possession|handover)(?:\s+(?:date|timeline|when))?\b/i },
  // Focused menu chip — bare "when" means possession on the open project.
  { key: 'possession', pattern: /^when\s*[?.!]?\s*$/i },
  // B5.1 — "when ready?" is delivery timeline, not config inventory.
  {
    key: 'possession',
    pattern: /\bwhen(?:'s| is)?(?:\s+it)?\s+ready(?!\s+to\s+move)\b|\bwhen\s+ready\b/i,
  },
  // The comparative form of the same question. "which is ready first" carries no
  // "when" and no "possession", so both closed sets were silent on it and the
  // turn fell through to a generic comparison card — twice in one live run.
  {
    key: 'possession',
    pattern:
      /\bready\s+(?:first|sooner|earlier)\b|\bwhich\s+(?:one\s+)?(?:is|will\s+be|gets)\s+ready\b|\bdelivers?\s+(?:first|sooner|earlier)\b|\bhands?\s+over\s+(?:first|sooner|earlier)\b/i,
  },
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
  // Wave 3 — "whats the cost here" co-asked with returns (not "cost of living").
  {
    key: 'price',
    pattern:
      /\b(?:what(?:'s|\s+is)\s+the\s+)?cost(?:\s+(?:here|there|for\s+this|of\s+this))?\b|\bcost\s*[?.!]/i,
  },
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
  stamp_duty: 'price',
  price_per_sqft: 'price',
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

  // Brochure/media embedder misbinds must not outrank a FactKey loan ask —
  // unless the buyer also explicitly asked for photos/brochure.
  const wantsExplicitMedia =
    /\b(?:photos?|images?|pics?|gallery|brochure|floor\s*plans?|layout|video|pdf)\b/i.test(text);
  let next: Extract<TurnGoal, { kind: 'answer' }> = { ...goal, requires };
  if (requires.includes('loan_eligibility')) {
    const topics = (goal.topics?.length ? goal.topics : [goal.topic]).filter(
      (t) => t !== 'media' || wantsExplicitMedia,
    );
    const withLegal = topics.includes('legal') ? topics : (['legal', ...topics] as AnswerTopic[]);
    const withMedia =
      wantsExplicitMedia && !withLegal.includes('media')
        ? ([...withLegal, 'media'] as AnswerTopic[])
        : withLegal;
    next = {
      ...next,
      topic: 'legal',
      ...(withMedia.length > 1 ? { topics: withMedia } : { topics: undefined }),
    };
  }
  // P2 residual: appreciation/resale/returns co-asked with price or loan —
  // keep overview so advisory/honest-miss is not swallowed by pricing/legal.
  if (requires.includes('appreciation') || requires.includes('rental_yield')) {
    const topics = next.topics?.length ? [...next.topics] : [next.topic];
    if (!topics.includes('overview')) {
      const withOverview = [...topics, 'overview'] as AnswerTopic[];
      next = {
        ...next,
        ...(withOverview.length > 1 ? { topics: withOverview } : {}),
      };
    }
  }
  // Wave 3 — returns + cost: keep price topic so pricing evidence is not dropped.
  // stamp_duty / price_per_sqft ride along: a buyer can ask for the statutory
  // heads or the rate without ever saying "price", and without the topic the
  // pricing fetch never runs — the contract then reports a miss for evidence
  // nobody went and got. "Are there any hidden charges?" is exactly that shape.
  if (
    requires.includes('price') ||
    requires.includes('stamp_duty') ||
    requires.includes('price_per_sqft')
  ) {
    const topics = next.topics?.length ? [...next.topics] : [next.topic];
    if (!topics.includes('price')) {
      const withPrice = [...topics, 'price'] as AnswerTopic[];
      next = {
        ...next,
        ...(withPrice.length > 1 ? { topics: withPrice } : {}),
      };
    }
  }
  // Loan + BHK/config inventory on a focused project — keep availability in
  // the multi set (do not let legal-only compose drop the unit ask).
  if (
    requires.includes('loan_eligibility') &&
    /\b(?:\d+\s*bhk|configs?|configurations?|units?|inventory|what'?s\s+available)\b/i.test(text)
  ) {
    const topics = next.topics?.length ? [...next.topics] : [next.topic];
    if (!topics.includes('availability')) {
      const withAvail = [...topics, 'availability'] as AnswerTopic[];
      next = {
        ...next,
        ...(withAvail.length > 1 ? { topics: withAvail } : {}),
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
  // A comparison delivers the same facts, two columns wide. This read only the
  // single-project detail, so "which is ready first" — a possession question by
  // any reading — came back "I don't have possession on file" with both dates
  // sitting in the matrix. A row counts as delivered only when it holds a real
  // value: the matrix fills empties with an em dash.
  const matrixKeys = new Set(
    (evidence.compare?.matrix?.rows ?? [])
      .filter((r) => r.values.some((v) => v.trim() && v.trim() !== '—'))
      .map((r) => (r.key ?? '').toLowerCase()),
  );
  if (matrixKeys.has('possession')) delivered.push('possession');
  if (matrixKeys.has('project_type')) delivered.push('project_type');
  if (matrixKeys.has('loan_eligibility')) delivered.push('loan_eligibility');
  if (matrixKeys.has('starting_price') || matrixKeys.has('price_range')) delivered.push('price');
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
  // Statutory add-ons are delivered only by a charge line that names one — the
  // base price is not an answer to "what is the stamp duty".
  const STATUTORY = /\b(?:stamp|registration|regn|gst|khata|statutory|govt|government)\b/i;
  if (
    evidence.landedCost?.oneTime.some((c) => STATUTORY.test(c.label)) ||
    evidence.pricing?.components?.some((c) => STATUTORY.test(c.label))
  ) {
    delivered.push('stamp_duty');
  }
  // A rate is only real when a published size and a published price meet.
  if (evidence.perSqft?.rows.length) delivered.push('price_per_sqft');
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
/** Multi-topic sibling evidence that can still speak when a FactKey misses. */
function hasSpeakableSiblingEvidence(
  goal: Extract<TurnGoal, { kind: 'answer' }>,
  evidence: EvidenceSet,
): boolean {
  const topics = goal.topics?.length ? goal.topics : [goal.topic];
  if (topics.includes('location') && evidence.location) return true;
  if (topics.includes('price') && (evidence.pricing || evidence.landedCost)) return true;
  if (topics.includes('media') && evidence.media) return true;
  if (topics.includes('availability') && (evidence.units?.length || evidence.detail)) return true;
  if (topics.includes('legal') && evidence.detail) return true;
  if (topics.includes('amenities') && evidence.detail?.amenities?.length) return true;
  return false;
}

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
  // Wave 3 — "schools + when ready": possession miss must not terminal-kill
  // location LI that answers the co-asked atom.
  if (!deliveredRequired.length) {
    if (hasSpeakableSiblingEvidence(goal, evidence)) {
      return {
        ...evidence,
        deliveredFacts,
        notices: failures,
      };
    }
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
