/**
 * Closed detect for ask_next_step — shared by the consumer and the
 * unknown-intent surface gate (must not import intent-authority).
 */
export const ASK_NEXT_STEP_RE =
  /\b(?:what(?:'s| is)?\s+(?:the\s+)?next(?:\s+step)?|what\s+should\s+(?:i|we)\s+do(?:\s+next)?|what\s+do\s+(?:i|we)\s+do(?:\s+(?:now|next))?|where\s+do\s+we\s+go\s+from\s+here|how\s+do\s+(?:i|we)\s+proceed(?:\s+from\s+here)?|how\s+do\s+we\s+move\s+forward|ok(?:ay)?\s+what\s+now|what\s+happens\s+next|what'?s\s+my\s+next\s+move|guide\s+me\s+on\s+the\s+next\s+step|take\s+me\s+to\s+the\s+next\s+step|aage\s+kya(?:\s+karna\s+hai)?|ab\s+kya\s+karu|next\s+step\s+kya\s+hai|(?:open|show|back\s+to)\s+(?:the\s+)?(?:board|shortlist)|put\s+(?:them|it|these)\s+on\s+(?:my\s+)?board)\b/i;

export function isAskNextStepText(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  // Facet / payment / EMI must stay with topic extractors.
  if (
    /\b(?:price|pricing|cost|rera|emi|payment|brochure|amenit|possession|availability|sq\.?\s*ft|bhk)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return ASK_NEXT_STEP_RE.test(t);
}
