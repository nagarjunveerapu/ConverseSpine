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
  about_ai: { policy: 'about_us', subject: 'identity' },
  about_data: { policy: 'about_us', subject: 'data_collection' },
});

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
  if (score < tau) return null;

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
