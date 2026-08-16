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
    // "who operates it?" / "is the payout guaranteed?" are revenue-model asks —
    // the 192-run showed them falling to overview cards on the resort family.
    key: 'revenue_model',
    re: /\b(?:revenue\s+model|revenue\s+share|pre-?leased|managed\s+(?:villa|resort)|rental\s+revenue|payout|guaranteed\s+(?:returns?|income|rent)|who\s+(?:operates|runs)\b|who\s+is\s+the\s+operator|operator\s+(?:name|brand))\b/i,
  },
  {
    key: 'resale_value',
    re: /\b(?:resale|appreciation|capital\s+gains?)\b|एप्रिसिएशन/i,
  },
  {
    // Desk calls the getting-out answer `exit` — resale trend, transferability,
    // lock-in. `resale_value` matches no row in the corpus.
    //
    // Deliberately NOT matching "can i sell … later": that phrasing family is
    // taught on the Understanding board, and a text bind here would disable the
    // teach (`taughtFaqKey` yields to any deterministic bind). A pattern must not
    // take a phrasing a human has already labelled.
    key: 'exit',
    re: /\b(?:resale|lock[- ]?in|freely\s+transferable|transferabilit\w+|exit\s+(?:option|route|value))\b/i,
  },
  {
    key: 'payment_plan',
    re: /\b(?:payment\s+plan|payment\s+schedule|construction[- ]linked(?:\s+plan)?|clp|down\s*payments?(?:\s+plan)?)\b/i,
  },
  {
    // Same ask, the other key. Desk holds 10 rows under `payment_process` and
    // only 2 under `payment_plan`; whichever the project carries, serves.
    key: 'payment_process',
    re: /\b(?:payment\s+(?:plan|schedule|process|terms)|construction[- ]linked(?:\s+plan)?|clp|down\s*payments?(?:\s+plan)?|when\s+do\s+i\s+pay|how\s+do\s+i\s+pay)\b/i,
  },
  {
    key: 'banks',
    re: /\b(?:loan\s+eligib|home\s+loan|bank\s+loan|housing\s+loan|which\s+banks?\s+(?:give|provide|approve|are\s+approved)|banks?\s+available|is\s+banks?\s+available|can\s+i\s+get\s+banks?|get\s+banks?\s+for|what\s+about\s+(?:banks?|loans?)|(?:tell\s+me\s+about|need)\s+(?:banks?|loan(?:\s+details)?|loan\s+eligibility)|about\s+banks?|loan\s+mil(?:e(?:ga|gi)?)?|ispe\s+loan|loan\s+ho\s+jayega)\b/i,
  },
  {
    // Desk canonical FAQ key is `banks` (loan_eligibility aliases there).
    // Focused chips + natural loan asks (incl. trailing ? / LTV).
    key: 'banks',
    re: /^(?:loans?)\s*[?.!]?\s*$|\b(?:(?:can|could|may|will)\s+(?:i|we)\s+(?:get|avail|take)\s+(?:a\s+|the\s+)?loan|(?:get|avail|take)\s+(?:a\s+|the\s+)?loan(?:\s+for|\s+on)?|eligible\s+for\s+(?:a\s+|the\s+)?loan|loan\s+(?:for\s+this|on\s+this|against)|\bltv\b|loan\s+to\s+value|can\s+i\s+get\s+approvals?)\b|\bloans?\s*[?.!]/i,
  },
  {
    // "is it ready to move?" (no trailing "in") is the same possession ask —
    // untreated it fell through to a configuration dump (B5.2).
    key: 'possession',
    re: /\b(?:possession(?:\s+date)?|possession\s+kab|when(?:'s| is)?\s+(?:possession|handover|completion)|(?:what\s+is\s+the\s+)?completion(?:\s+date)?|handover(?:\s+date)?|delivery\s+(?:date|timeline)|ready\s+to\s+move(?:\s+in)?|kab\s+(?:possession|handover|milega)|kab\s+milega|milega\s+batao)\b|कब\s*मिलेगा|ಪೊಸೆಷನ್|పొసెషన్/i,
  },
  {
    // "move in", "shift in", "check in" are never locative — they ask whether the
    // project is READY (founder, 16 Aug). Untreated, "can i move in right away?"
    // resolved to NO key, fell through to the locality capture, and the "in" —
    // a verb particle, not a preposition of place — yielded a place called
    // *right*: "I don't have homes in *right*". The ask was possession all along,
    // so this is the possession lane's gap, not a deny-list for the extractor.
    key: 'possession',
    re: /\b(?:mov(?:e|ing)|shift(?:ing)?|check(?:ing)?)\s+in(?:to)?\b(?!\s+with)|\bwhen\s+can\s+(?:i|we)\s+(?:move|shift)\b/i,
  },
  {
    // Focused menu chip — bare "when" → possession on the open project.
    key: 'possession',
    re: /^when\s*[?.!]?\s*$/i,
  },
  {
    // Wave 3 / B5.1 — "when ready?" chip (not config inventory).
    key: 'possession',
    re: /\bwhen(?:'s| is)?(?:\s+it)?\s+ready(?!\s+to\s+move)\b|\bwhen\s+ready\b|^(?:delivery|handover)\s*[?.!]?\s*$/i,
  },
  {
    // Discount/offer chip + free-text negotiate — land on payment_plan FAQ when
    // Desk has it; else FactKey `price` still drives the answer contract.
    key: 'payment_plan',
    re: /^(?:discounts?|offers?)\s*[?.!]?\s*$|\b(?:any\s+)?(?:best\s+)?(?:price|discount|offer)s?\s+(?:on\s+this|for\s+this)|(?:any|best)\s+(?:price|discount|offer)s?\b/i,
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
    // Desk's key is `maintenance` — 16 approved rows, every one of them stranded
    // behind the `_charges` suffix. "maintenance in both" got the comparison card.
    key: 'maintenance',
    re: /\b(?:maintenance(?:\s+charges?)?|cam\s+charges?|upkeep\s+cost)\b/i,
  },
  {
    // Desk question_key is `water_power` (brigade enrichment / live corpus).
    // "how is water and power there?" (D2.16) missed the supply-only phrasing.
    key: 'water_power',
    re: /\b(?:water\s+(?:supply|connection)|water\s+and\s+power|power\s+(?:supply|and\s+water)|electricity|bescom|bwssb)\b/i,
  },
  {
    key: 'site_visit',
    re: /\b(?:site\s+visit\s+hours|visit\s+timings?|when\s+can\s+i\s+visit)\b/i,
  },
  {
    key: 'builder_credibility',
    re: /\b(?:(?:builder|developer)\s+(?:track\s+record|credibility|reputation|honesty|honest|kaun)|builder\s+kaun\s+hai|is\s+(?:the\s+|this\s+)?builder\s+honest|how\s+reliable\s+is\s+(?:the\s+)?builder|who\s+is\s+the\s+builder|honest\s+(?:builder|person))\b|बिल्डर\s*कौन|ट्रैक\s*रिकॉर्ड/i,
  },
  {
    key: 'rera_status',
    re: /\b(?:rera\s+status|is\s+(?:it\s+|this\s+)?rera\s+(?:registered|approved|certified)|rera\s+certified)\b/i,
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
    // Desk files the WHOLE location bucket under `location_schools` — the street
    // address, connectivity, airport and IT-park distances, not just schools.
    // 40 approved rows, and nothing could reach them: `airport_distance` and
    // `connectivity` are names no row in the corpus answers to. This is why the
    // flagship could not say its own address in six tries, and why "which one is
    // closer to the airport" came back as a generic comparison card.
    //
    // Placed after schools / hospitals / metro (those bind first and answer more
    // precisely) but ahead of `airport_distance`, which is a dead name: a live
    // key must never queue behind one nothing can serve.
    //
    // Deliberately NOT matching bare "location" / "location details": that is a
    // chip ask with a structured owner, and binding a key the project may not
    // hold turns a good location card into "I don't have that on file". Only the
    // phrasings the structured card does not answer — the street address, the
    // distances, connectivity — reach for the written row.
    key: 'location_schools',
    re: /\bwhere(?:'s|\s+is|\s+exactly)\b|\baddress\b|\b(?:connectivity|well[- ]connected)\b|\bhow\s+far\b|\bdistance\s+(?:to|from)\b|\b(?:itpl|it\s+park|tech\s+park)\b/i,
  },
  {
    // One project files the same answer under its own name.
    key: 'project_location',
    re: /\bwhere(?:'s|\s+is|\s+exactly)\b|\baddress\b/i,
  },
  {
    key: 'airport_distance',
    re: /\b(?:airport(?:\s+distance)?|how\s+far(?:\s+is)?\s+(?:the\s+)?airport|airport\s+kitna\s+door|kitna\s+door(?:\s+hai)?)\b/i,
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
    // "tell me about the coffee and pepper crops" / "do I have to manage the
    // farm myself?" (D2.9 / D2.10) are plantation-detail asks.
    key: 'plantation_details',
    re: /\bplantation\s+(?:details?|management)\b|\bwhat\s+(?:crops?|is\s+grown)\b|\b(?:coffee|pepper|areca)\b.{0,25}\bcrops?\b|\bcoffee\s+and\s+pepper\b|\bmanage\s+the\s+(?:farm|estate|plantation)\b|\bwho\s+(?:maintains|manages)\s+the\s+(?:farm|estate|plantation|crops?)\b/i,
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
  // "how big is the township / community?" (B9.4, F.8) counts too.
  {
    key: 'total_units_and_towers',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?|township|community|project)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
  {
    key: 'project_scale',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?|township|community|project)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
  {
    key: 'township_scale',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?|township|community|project)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
  {
    key: 'community_size',
    re: /\bhow\s+(?:many|big)\b.*\b(?:units?|towers?|acres?|homes?|township|community|project)\b|\btotal\s+units?\b|\bproject\s+(?:size|scale)\b/i,
  },
  {
    // "is it MUDA or DTCP approved?" (C2.5) — the approval-body ask.
    key: 'plan_approval',
    re: /\b(?:muda|dtcp|biapa|bmrda|bda)\b|\bplan\s+approval\b|\blayout\s+approv|\bapproved\s+layout\b/i,
  },
  {
    // "can I start construction immediately?" (C2.7).
    key: 'construction_rules',
    re: /\bconstruction\s+(?:rules?|guidelines?|restrictions?|timeline)\b|\b(?:start|begin)\s+construction\b|\bwhen\s+can\s+i\s+(?:build|construct)\b|\bbuild(?:ing)?\s+(?:rules?|guidelines?|restrictions?)\b/i,
  },

  // ——— AB-1, second sweep: the rest of the orphaned corpus ———
  // A key-by-key diff of the live corpus against the keys these patterns can
  // emit found 137 of 456 approved answers unreachable, and eight patterns
  // aimed at names no row uses. Everything below is a name repair — the answer
  // was already written and approved, and every lookup stays gated on the
  // project holding the row.
  {
    key: 'promoter_info',
    re: /\bpromoter\b|\bwho\s+(?:is\s+)?(?:the\s+)?(?:builder|developer)\b|\bwho\s+(?:is\s+)?(?:building|developing)\b/i,
  },
  {
    key: 'compact_units',
    re: /\b(?:compact|smallest|budget[- ]friendly|entry[- ]level)\s+(?:units?|options?|homes?|flats?)\b|\bsmallest\s+(?:unit|flat|home|apartment)\b|\bdo\s+you\s+have\s+(?:a\s+)?1\s*bhk\b/i,
  },
  // `configurations_summary` (4 rows) and `pricing` (26) are deliberately NOT
  // bound here. Both sit on top of a structured answer the engine already gives
  // — the config card and the pricing card — so binding them would attach a
  // second, whole-project answer to a size-scoped or unit-scoped question. That
  // is the over-answer dump, not a repair. They need a compose-side gate ("serve
  // the written row only when the structured answer missed"), which is its own
  // change.
  {
    key: 'project_type_summary',
    re: /\b(?:what\s+(?:type|kind)\s+of\s+(?:project|property)|project\s+type|property\s+type)\b/i,
  },
  {
    key: 'base_rate',
    re: /\bbase\s+(?:rate|price)\b|\brate\s+per\s+(?:sq\.?\s*ft|sqft|square\s*(?:feet|foot))\b|\bpsf\s+rate\b/i,
  },
  {
    key: 'floor_plan',
    re: /\bfloor\s*plans?\b|\bunit\s+plans?\b|\blayout\s+plan\b/i,
  },
  {
    // Plotted sibling of `security` — fencing and demarcation before you build.
    key: 'plot_security',
    re: /\b(?:fenced|fencing|compound\s+wall|demarcat\w+)\b|\bsecurity\b.{0,20}\bplot\b|\bplot\b.{0,20}\bsecurity\b/i,
  },
  {
    key: 'private_garden',
    re: /\b(?:private\s+)?gardens?\b|\bbackyard\b|\bown\s+(?:garden|yard)\b/i,
  },
  {
    key: 'build_coverage',
    re: /\b(?:can\s+i\s+build|buildable|build(?:ing)?\s+(?:area|coverage|ratio)|how\s+much\s+can\s+i\s+(?:build|construct))\b/i,
  },
  {
    key: 'ec_status',
    re: /\b(?:ec|encumbrance)\b/i,
  },
  {
    // Generic "what is this project" — Desk keeps a written summary for the
    // families whose overview card is thin (managed resort villas, plotted).
    key: 'project_info',
    re: /\bwhat\s+is\s+(?:this|the)\s+(?:project|property|development)\b|\btell\s+me\s+what\s+this\s+is\b/i,
  },
];

const TOPIC_TO_FAQ_KEYS: Partial<Record<AnswerTopic, readonly string[]>> = {
  amenities: ['amenities', 'amenities_summary'],
  legal: ['rera_status', 'rera_number', 'legal_status', 'khata', 'banks', 'loan_eligibility'],
  location: ['connectivity', 'metro_connectivity', 'airport_distance', 'nearby_schools', 'nearby_hospitals'],
  availability: ['possession', 'ready_to_move', 'configurations'],
  emi: ['banks', 'loan_eligibility', 'loan'],
};

/** Inverse of TOPIC_TO_FAQ_KEYS (+ text-bound keys that belong to a topic). */
const FAQ_KEY_TO_TOPIC: Readonly<Record<string, AnswerTopic>> = Object.freeze(
  Object.fromEntries(
    Object.entries(TOPIC_TO_FAQ_KEYS).flatMap(([topic, keys]) =>
      (keys ?? []).map((key) => [key, topic as AnswerTopic]),
    ),
  ) as Record<string, AnswerTopic>,
);

/**
 * Drop FAQ keys owned by parked topics so Phase C top-2 does not still answer
 * the parked atom via text-bound FAQ lookup (possession while availability parked).
 */
export function excludeParkedFaqKeys(
  keys: readonly string[],
  parked: readonly AnswerTopic[] | undefined,
): string[] {
  if (!parked?.length) return [...keys];
  const blocked = new Set(parked);
  return keys.filter((key) => {
    const topic = FAQ_KEY_TO_TOPIC[key];
    return !topic || !blocked.has(topic);
  });
}

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

  // 4, not 3: the scale ask fans to four sibling keys (total_units_and_towers /
  // project_scale / township_scale / community_size) — projects hold exactly one,
  // so the lookups stay gated and only that one composes.
  return out.slice(0, 4);
}

/** True when the utterance is a FAQ-shaped ask (not a generic overview). */
export function isFaqShapedAsk(text: string): boolean {
  return resolveFaqQuestionKeys(text).length > 0;
}

/**
 * Is this sentence asking, or telling?
 *
 * Lived in compose.ts, where it kept the engine from answering "2027 is too late
 * for me" with "I don't have that on file". The extractors need the same
 * distinction for the opposite reason — a preference may only be recorded from a
 * buyer who STATED one. "Is it ready to move in?" is a question about one
 * project, and reading it as a standing filter is how a March 2027 project came
 * to answer it with "Yes".
 *
 * Here rather than in compose because compose imports facts, so facts cannot
 * import compose. This module is a leaf and already owns ask-shape predicates.
 */
export function looksLikeAQuestion(text?: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (t.includes('?')) return true;
  return /^(?:what|when|where|which|who|whom|whose|why|how|is|are|was|were|do|does|did|can|could|will|would|should|shall|may|any|tell me|show me|send|give me|share)\b/i.test(
    t,
  );
}

/**
 * Taught sub-intent → FAQ key. A human taught this phrasing family a facet on
 * the Understanding board (Desk mirrors it into vector metadata); when THIS
 * turn's embed bind carried one, compose pins that exact Desk FAQ row on the
 * focused project ("can i sell the plot later?" → resale_value, not the
 * overview card). Deterministic lanes keep precedence: a text-bound FAQ key
 * disables the taught key entirely, and the key stays lookup-gated — a project
 * without the row composes exactly as before.
 */
export function taughtFaqKey(
  routing:
    | { routing?: string; embedder_facet?: string; bind?: { bind_source?: string } }
    | undefined,
  text: string,
): string | undefined {
  if (routing?.routing !== 'answer_on_project') return undefined;
  if (routing.bind?.bind_source !== 'embed_intent') return undefined;
  const facet = routing.embedder_facet ?? '';
  // Same shape Desk validates at teach time — anything else is index noise.
  if (!/^[a-z0-9_]{1,60}$/.test(facet)) return undefined;
  if (resolveFaqQuestionKeys(text).length > 0) return undefined;
  return facet;
}
