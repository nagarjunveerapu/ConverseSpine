import type { AnswerTopic } from '../types.js';
import type { PolicyClass, TurnRoutingInput, TurnRoutingResult } from './types.js';

export const ROUTING_TAU_HIGH = 0.78;
export const ROUTING_TAU_LOW = 0.62;

const INTENT_TO_TOPIC: Record<string, AnswerTopic> = {
  get_price: 'price',
  get_legal_info: 'legal',
  get_availability: 'availability',
  get_unit_configs: 'availability',
  get_brochure: 'media',
  get_media: 'media',
  get_amenities: 'amenities',
  get_location_info: 'location',
  ask_delivery_timeline: 'availability',
  get_project_info: 'overview',
  ask_about_builder: 'overview',
  compute_emi: 'emi',
  get_payment_plan: 'price',
  negotiate_price: 'price',
  ask_investment_return: 'overview',
};

const ANSWER_INTENTS = new Set([
  'get_price',
  'get_legal_info',
  'get_availability',
  'get_unit_configs',
  'get_brochure',
  'get_media',
  'get_amenities',
  'get_location_info',
  'ask_delivery_timeline',
  'get_project_info',
  'ask_about_builder',
  'compute_emi',
  'get_payment_plan',
  'negotiate_price',
  'ask_investment_return',
]);

const POLICY_INTENTS: Readonly<
  Record<string, { policy: PolicyClass; subject: string }>
> = Object.freeze({
  policy_prohibited: { policy: 'prohibited', subject: 'protected_identity_filter' },
  policy_investment_metric: { policy: 'out_of_scope', subject: 'investment_return' },
  policy_internal_instructions: {
    policy: 'out_of_scope',
    subject: 'internal_instructions',
  },
  definition_bhk: { policy: 'definition', subject: 'bhk' },
  definition_ready_to_move: { policy: 'definition', subject: 'ready_to_move' },
  // Wave-1 recognition doors only — curriculum answers live in Desk education KB.
  definition_property_type: { policy: 'definition', subject: 'property_type' },
  definition_buying_journey: { policy: 'definition', subject: 'buying_journey' },
  definition_documents: { policy: 'definition', subject: 'documents' },
  about_ai: { policy: 'about_us', subject: 'identity' },
  about_data: { policy: 'about_us', subject: 'data_collection' },
});

const CALIBRATED_POLICY_KINDS = new Set([
  'policy_prohibited',
  'definition_bhk',
  'definition_ready_to_move',
  'definition_property_type',
  'definition_buying_journey',
  'definition_documents',
]);

/**
 * Narrow policy classes use calibrated floors. The projected index can put a
 * clear protected-identity or Wave-1 definition request just below the general
 * routing tau; abstaining there is more harmful than binding the already-winning
 * policy class.
 */
export function bindTauForIntent(
  kind: string,
  tau: number,
  failureRouting: boolean,
): number {
  return failureRouting && CALIBRATED_POLICY_KINDS.has(kind)
    ? Math.min(tau, 0.8)
    : tau;
}

/** Recognition kinds that answer from the Desk education KB once Phase 2 binds. */
export const DEFINITION_INTENT_KINDS = Object.freeze([
  'definition_bhk',
  'definition_ready_to_move',
  'definition_property_type',
  'definition_buying_journey',
  'definition_documents',
] as const);

export function looksLikeDefinitionAsk(text: string): boolean {
  return /\b(?:what\s+is|what'?s|meaning|mean(?:s|ing)?|explain|define|definition|matlab|bolte|terminology|how\s+does\s+.+\s+work)\b/i.test(
    text,
  );
}

/**
 * Search brief with a configuration + place cue — not a literacy ask.
 * "3 BHK in Mumbai" must stay on discover/search, not definition_bhk.
 */
export function looksLikeSearchBrief(text: string): boolean {
  if (looksLikeDefinitionAsk(text)) return false;
  const hasConfig =
    /\b\d+\s*bhk\b/i.test(text) ||
    /\b(?:villas?|apartments?|flats?|plots?|houses?|homes?)\b/i.test(text);
  const hasPlaceCue = /\b(?:in|near|around|at|within)\s+[a-z\u00c0-\u024f]/i.test(text);
  return hasConfig && hasPlaceCue;
}

export function hasVisitRoutingContext(input: TurnRoutingInput): boolean {
  return (
    input.phase === 'visit' ||
    (input.visit?.booked_count ?? 0) >= 1 ||
    (input.visit?.queued_count ?? 0) >= 1 ||
    !!input.visit?.project_id
  );
}

function projectId(input: TurnRoutingInput): string | undefined {
  return input.named_project_ids?.[0];
}

/** Map Vectorize intent_kind + score to coarse routing (RTI-3B enforce). */
export function mapIntentToRouting(
  kind: string,
  score: number,
  input: TurnRoutingInput,
  /** Bind threshold for the ACTIVE vector space. Defaults to the raw-model
   *  value; a projected deployment passes its own calibrated tau, because a
   *  cosine of 0.78 means different things in different geometries. */
  tau: number = ROUTING_TAU_HIGH,
  failureRouting = false,
): TurnRoutingResult | null {
  if (score < bindTauForIntent(kind, tau, failureRouting)) return null;

  const pid = projectId(input);
  const base = {
    confidence: 'embedder' as const,
    embedder_intent_kind: kind,
    embedder_score: score,
    ...(pid ? { project_id: pid } : {}),
  };

  if (failureRouting) {
    const policyIntent =
      POLICY_INTENTS[kind] ??
      (kind === 'negotiate_price'
        ? { policy: 'out_of_scope' as const, subject: 'discount' }
        : undefined);
    if (policyIntent) {
      // Definition doors are literacy asks. A search brief that merely mentions
      // "3 BHK in Mumbai" must not early-exit into educationSearch.
      if (
        policyIntent.policy === 'definition' &&
        looksLikeSearchBrief(input.text)
      ) {
        return null;
      }
      return {
        routing: 'unsupported',
        policy: policyIntent.policy,
        subject: policyIntent.subject,
        ...base,
      };
    }
  }

  if (kind === 'book_visit') {
    return { routing: 'visit_schedule_stop', ...base };
  }

  if (kind === 'compare_projects') {
    return { routing: 'compare_offered', ...base };
  }

  if (kind === 'find_projects' || kind === 'recommend') {
    return { routing: 'search_pivot', ...base };
  }

  if (ANSWER_INTENTS.has(kind)) {
    const topic = INTENT_TO_TOPIC[kind] ?? 'overview';
    // Bare "what about X" in explore — prefer answer unless active visit queue.
    if (
      /\bwhat about\b/i.test(input.text) &&
      !hasVisitRoutingContext(input) &&
      kind === 'get_project_info'
    ) {
      return { routing: 'answer_on_project', answer_topic: 'overview', ...base };
    }
    return { routing: 'answer_on_project', answer_topic: topic, ...base };
  }

  return null;
}

/** The kinds INTENT_TO_TOPIC already owns. Exported so the intent-authority
 *  table can be tested for overlap — one owner per kind, enforced, not hoped. */
export const INTENT_TO_TOPIC_KEYS: readonly string[] = Object.keys(INTENT_TO_TOPIC);
export const POLICY_INTENT_KEYS: readonly string[] = Object.keys(POLICY_INTENTS);
