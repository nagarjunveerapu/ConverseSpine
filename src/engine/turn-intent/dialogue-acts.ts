/**
 * Closed dialogue affirm/decline sets (L2). Shared by classify + focused pivot
 * so Hinglish declines never invent localities or re-search.
 * Keep aligned with facts.ts AFFIRM / DECLINE_UTTERANCE.
 */
export const AFFIRM_ONLY =
  /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|haan?|haaji|theek(?:\s+hai)?|done|confirm(?:ed)?|go ahead|sounds good|perfect|great|yeah\s+sure|yes\s+please|ok\s+sure|sure\s+yes)\.?!?\s*$/i;

/** Decline after CTA / focused soft-pass — includes "no thanks" and "nahi chahiye". */
export const DECLINE =
  /^(?:no|nope|nah|nahi(?:n)?(?:\s+chahiye)?|no\s+thanks|no\s+thank\s+you|not\s+now|not\s+interested|not\s+that|not\s+this|something\s+else)\.?!?\s*$/i;
