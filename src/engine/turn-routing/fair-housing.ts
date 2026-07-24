/**
 * Fair-housing / protected-identity refusal floor.
 *
 * Prohibited-class asks cannot be recognition-bound: a miss is not "no answer",
 * it is complying with a discriminatory filter. Embedding + tau coverage is
 * ~70% here; a deterministic keyword floor is the safety backstop.
 *
 * This is not an understanding regex. The founder rule (misses fixed in the
 * embedding lane) applies to topic understanding — not to a fair-housing
 * contract where false negatives are unacceptable and false positives are ok.
 */

import type { TurnRoutingResult } from './types.js';

/**
 * True when the buyer text asks to filter / shortlist / prefer homes by a
 * protected identity class (caste, religion, communal majority).
 */
export function detectProtectedIdentityFilter(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  // Strip common non-identity "community" compounds before testing.
  const scrubbed = t
    .replace(/\bgated\s+communit(?:y|ies)\b/g, ' ')
    .replace(/\bcommunit(?:y|ies)\s+hall\b/g, ' ')
    .replace(/\bcommunit(?:y|ies)\s+amenities?\b/g, ' ');

  const identity =
    /\b(caste|religion|religious|communal|muslim|hindu|christian|sikh|jain|buddhist)\b/.test(
      scrubbed,
    ) ||
    /\b(?:my|our|own)\s+community\b/.test(scrubbed) ||
    /\bcommunity\b.{0,48}\b(?:mostly|majority|filter|shortlist|hisab|hisaab)\b/.test(
      scrubbed,
    ) ||
    /\b(?:filter|shortlist|mostly|majority|hisab|hisaab).{0,48}\bcommunity\b/.test(
      scrubbed,
    );

  if (!identity) return false;

  // Explicit majority framing is itself the discriminatory ask.
  if (
    /\b(muslim|hindu|christian|sikh|jain|buddhist|caste|religion|religious|communal)[- ]?majority\b/.test(
      scrubbed,
    )
  ) {
    return true;
  }

  const filterVerb =
    /\b(only|filter|shortlist|majority|mostly|based\s+on|filter\s+out|don'?t\s+show|do\s+not\s+show|sirf|dikhao|wali|zyada|hisab|hisaab)\b/.test(
      scrubbed,
    ) ||
    /\blive\s+with\s+(?:people\s+)?(?:of\s+)?(?:my|our|own)\b/.test(scrubbed);

  return filterVerb;
}

/** Deterministic routing verdict — wins over embedder / search. */
export function fairHousingRouting(): TurnRoutingResult {
  return {
    routing: 'unsupported',
    confidence: 'rule',
    policy: 'prohibited',
    subject: 'protected_identity_filter',
    bind: {
      bind_source: 'regex',
      embed_fired: false,
      embed_gate: 'fair_housing_floor',
    },
  };
}
