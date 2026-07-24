import type { Failure } from './outcome.js';
import { hasAppreciation, hasInvestmentRoi, hasRentBands } from './market-intel.js';
import type { EvidenceSet, FactKey, TurnGoal } from './types.js';

const REQUIREMENT_PATTERNS: ReadonlyArray<{ key: FactKey; pattern: RegExp }> = [
  { key: 'carpet_area', pattern: /\bcarpet\s+(?:area|size)\b/i },
  { key: 'built_up_area', pattern: /\b(?:built[- ]?up|super\s+built[- ]?up|sba)\s*(?:area|size)?\b/i },
  { key: 'possession', pattern: /\b(?:possession|handover)(?:\s+(?:date|timeline|when))?\b/i },
  { key: 'rera', pattern: /\brera(?:\s+(?:number|status|registration))?\b/i },
  { key: 'khata', pattern: /\bkhata\b/i },
  { key: 'ec_status', pattern: /\b(?:ec|encumbrance)\s+(?:status|certificate|clear)?\b/i },
  { key: 'loan_eligibility', pattern: /\b(?:home\s+loan|loan\s+eligibility|approved\s+banks?|which\s+banks?)\b/i },
  { key: 'project_type', pattern: /\b(?:property|project)\s+type\b/i },
  { key: 'price', pattern: /\b(?:price|pricing|starting\s+price|how\s+much)\b/i },
  { key: 'flood_zone', pattern: /\b(?:flood|flooding|flood[- ]?zone)\b/i },
  // Advisory atoms — deliver when approved market intel / project ROI is on
  // detail; otherwise no_data (C1: never invent a %).
  { key: 'rental_yield', pattern: /\b(?:rental\s+yield|yield|roi|return\s+on\s+investment|rental\s+returns?|rental\s+income)\b/i },
  { key: 'appreciation', pattern: /\b(?:appreciat\w*|how\s+much\s+has\s+(?:this\s+)?(?:area|corridor)\s+grown|corridor\s+growth)\b/i },
];

export function answerRequirements(text: string): FactKey[] {
  return REQUIREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ key }) => key);
}

export function withAnswerRequirements(
  goal: Extract<TurnGoal, { kind: 'answer' }>,
  text: string,
): Extract<TurnGoal, { kind: 'answer' }> {
  const requires = answerRequirements(text);
  return requires.length ? { ...goal, requires } : goal;
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
    faqKeys.has('loan')
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
