/**
 * Closed-set buyer text → NayaDesk FAQ question_key.
 * Keys must exist in Desk `faqs.question_key` — never invent answers here.
 */
import type { AnswerTopic } from './types.js';

/** Deterministic FAQ key patterns — order = priority when multiple match. */
const FAQ_KEY_PATTERNS: ReadonlyArray<{ key: string; re: RegExp }> = [
  {
    key: 'rental_yield',
    re: /\b(?:rental\s+yield|yield(?:\s+kitna)?|roi|returns?|rental\s+income|how\s+much\s+rent|rent(?:al)?\s+(?:potential|income|return|kitna))\b/i,
  },
  {
    key: 'revenue_model',
    re: /\b(?:revenue\s+model|revenue\s+share|pre-?leased|managed\s+(?:villa|resort)|rental\s+revenue)\b/i,
  },
  {
    key: 'resale_value',
    re: /\b(?:resale|appreciation|capital\s+gains?)\b/i,
  },
  {
    key: 'payment_plan',
    re: /\b(?:payment\s+plan|payment\s+schedule|construction[- ]linked|clp|down\s+payment\s+plan)\b/i,
  },
  {
    key: 'loan_eligibility',
    re: /\b(?:loan\s+eligib|home\s+loan|bank\s+loan|housing\s+loan|which\s+banks?\s+(?:give|provide|approve))\b/i,
  },
  {
    // "is it ready to move?" (no trailing "in") is the same possession ask —
    // untreated it fell through to a configuration dump (B5.2).
    key: 'possession',
    re: /\b(?:possession(?:\s+date)?|possession\s+kab|when(?:'s| is)?\s+(?:possession|handover)|delivery\s+(?:date|timeline)|ready\s+to\s+move(?:\s+in)?|kab\s+(?:possession|handover))\b/i,
  },
  {
    key: 'amenities',
    re: /\b(?:amenities|amenity|facilit(?:y|ies)?|clubhouse|swimming\s+pool|\bpools?\b|\bgyms?\b|sports?\s+facilit(?:y|ies)?)\b/i,
  },
  {
    key: 'maintenance_charges',
    re: /\b(?:maintenance(?:\s+charges?)?|cam\s+charges?|upkeep\s+cost)\b/i,
  },
  {
    // Desk question_key is `water_power` (brigade enrichment / live corpus).
    key: 'water_power',
    re: /\b(?:water\s+(?:supply|connection)|power\s+supply|electricity|bescom|bwssb)\b/i,
  },
  {
    key: 'site_visit',
    re: /\b(?:site\s+visit\s+hours|visit\s+timings?|when\s+can\s+i\s+visit)\b/i,
  },
  {
    key: 'builder_credibility',
    re: /\b(?:builder\s+(?:track\s+record|credibility|reputation)|how\s+reliable\s+is\s+(?:the\s+)?builder)\b/i,
  },
  {
    key: 'rera_status',
    re: /\b(?:rera\s+status|is\s+(?:it\s+)?rera\s+(?:registered|approved))\b/i,
  },
  {
    // "schools near <project>" / "schools around" must route too (S1 — the
    // nearby-only phrasing missed the most natural focused ask).
    key: 'nearby_schools',
    re: /\b(?:schools?\s+(?:near(?:by)?|around|close)|nearby\s+schools?|good\s+schools?)\b/i,
  },
  {
    key: 'nearby_hospitals',
    re: /\b(?:hospitals?\s+(?:near(?:by)?|around|close)|nearby\s+hospitals?)\b/i,
  },
  {
    key: 'metro_connectivity',
    re: /\b(?:metro(?:\s+connectivity|\s+access)?|namma\s+metro)\b/i,
  },
  {
    key: 'airport_distance',
    re: /\b(?:airport(?:\s+distance)?|how\s+far(?:\s+is)?\s+(?:the\s+)?airport)\b/i,
  },

  // ——— AB-1: the orphaned corpus ———
  // 45% of approved FAQ rows had no pattern reaching them, so real, approved
  // answers were never served — "as an NRI how can I invest?" got an overview
  // card while the written nri_buying answer sat in Desk. Every key below is
  // verified to exist in the live corpus, and every lookup stays gated on the
  // project actually having a row (misses fall to the honest-miss path).
  {
    key: 'nri_buying',
    re: /\bnris?\b|\bnon[- ]resident|\b(?:oci|pio)\b|\b(?:buy|invest|purchase)\w*\s+from\s+(?:abroad|overseas|dubai|the\s+us|usa|uk|singapore)\b/i,
  },
  {
    key: 'gst_registration',
    re: /\bgst\b/i,
  },
  {
    key: 'booking_process',
    re: /\bbook(?:ing)?\s+(?:process|amount|procedure|steps?)\b|\bhow\s+(?:do|can)\s+i\s+book\b|\b(?:token|blocking)\s+amount\b/i,
  },
  {
    key: 'khata',
    re: /\bkhata\b/i,
  },
  {
    key: 'parking',
    re: /\bparking\b|\bcar\s+park/i,
  },
  {
    key: 'pet_policy',
    re: /\bpets?\b|\bpet[- ]friendly\b|\bdogs?\s+allowed\b/i,
  },
  {
    key: 'vastu',
    re: /\bvastu\b/i,
  },
  {
    // Some projects keep one combined pets+vastu row — push it as the gated
    // second candidate for either ask; whichever key the project has, serves.
    key: 'pets_vastu',
    re: /\bvastu\b|\bpets?\b/i,
  },
  {
    key: 'security',
    re: /\bsecurity\b|\bcctv\b|\bgated\s+community\b/i,
  },
  {
    key: 'plot_sizes',
    re: /\bplot\s+(?:sizes?|dimensions?)\b/i,
  },
  {
    key: 'plantation_details',
    re: /\bplantation\s+(?:details?|management)\b|\bwhat\s+(?:crops?|is\s+grown)\b|\bcoffee\s+(?:yield|crop)/i,
  },
  {
    key: 'customization',
    re: /\bcustomi[sz]/i,
  },
  {
    key: 'plc_premium',
    re: /\bplc\b|\b(?:corner|park[- ]facing)\s+(?:plot\s+|unit\s+)?premium\b|\bpreferential\s+location\b/i,
  },
  {
    key: 'utilities',
    re: /\butilit(?:y|ies)\b/i,
  },
  {
    key: 'construction_status',
    re: /\bconstruction\s+(?:status|progress|stage|update)\b|\bhow\s+far\s+along\b/i,
  },
  {
    key: 'investment_case',
    re: /\b(?:good|worth|smart)\s+invest(?:ment|ing)\b|\binvestment\s+case\b|\bshould\s+i\s+invest\b/i,
  },
  {
    key: 'green_certified',
    re: /\bgreen\s+certif|\bigbc\b|\bleed\b/i,
  },
  {
    key: 'operator_shutdown_risk',
    re: /\boperator\s+(?:shuts?\s*down|shutdown|risk|fails?)\b|\bwhat\s+(?:if|happens)\b.*\boperator\b/i,
  },
  {
    key: 'airbnb',
    re: /\bairbnb\b|\bshort[- ]term\s+(?:rental|let|stay)/i,
  },
  {
    key: 'transport_pickup',
    re: /\b(?:pickup|shuttle)\b|\btransport\s+(?:to|from)\b/i,
  },
  // Scale asks land on whichever scale key the project carries (all gated).
  {
    key: 'total_units_and_towers',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
  {
    key: 'project_scale',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
  {
    key: 'township_scale',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
];

const TOPIC_TO_FAQ_KEYS: Partial<Record<AnswerTopic, readonly string[]>> = {
  amenities: ['amenities', 'amenities_summary'],
  legal: ['rera_status', 'rera_number', 'legal_status', 'khata', 'loan_eligibility'],
  location: ['connectivity', 'metro_connectivity', 'airport_distance', 'nearby_schools', 'nearby_hospitals'],
  availability: ['possession', 'ready_to_move', 'configurations'],
  emi: ['loan_eligibility', 'loan'],
};

/**
 * Resolve Desk FAQ keys for this buyer utterance.
 * Prefer explicit text matches; fall back to topic→key hints (still lookup-gated).
 */
export function resolveFaqQuestionKeys(
  text: string,
  topics: readonly AnswerTopic[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  const t = text.trim();
  if (t) {
    for (const { key, re } of FAQ_KEY_PATTERNS) {
      if (re.test(t)) push(key);
    }
  }

  // Topic hints only when text did not already bind a key (avoid dumping every legal FAQ).
  if (out.length === 0) {
    for (const topic of topics) {
      for (const key of TOPIC_TO_FAQ_KEYS[topic] ?? []) push(key);
    }
  }

  return out.slice(0, 3);
}

/** True when the utterance is a FAQ-shaped ask (not a generic overview). */
export function isFaqShapedAsk(text: string): boolean {
  return resolveFaqQuestionKeys(text).length > 0;
}
