/**
 * Whether the buyer utterance frames a place ask (in/near/…) vs a brief
 * comma-lead token that may be noise ("Buy, 70 lakh").
 *
 * Outside-served coverage only fires for place-framed misses. Non-framed
 * unresolved localities are dropped so we do not grow a denylist of verbs.
 */
export function looksLikePlaceFramedAsk(text: string): boolean {
  return /\b(?:in|near|around|at|within|mein)\s+[a-z\u00c0-\u024f]/i.test(text);
}
