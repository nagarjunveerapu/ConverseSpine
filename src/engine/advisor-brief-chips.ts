/** UI brief chip labels — must never be stored as geographic locations. */
export const ADVISOR_BRIEF_CHIP_PHRASES = new Set(
  [
    'Self-use',
    'Investment',
    'Not sure yet',
    'Capital appreciation',
    'Rental income',
    'Diversification',
    'Wealth preservation',
    '₹40–50L',
    '₹50–70L',
    '₹70L–1 Cr',
    '₹1 Cr+',
    '1 BHK',
    '2 BHK',
    '3 BHK',
    '4+ BHK',
    'Apartment',
    'Villa',
    'Plot / land',
    'Planted estate',
    'Plot / Villa',
    'Open to suggestions',
    'Next 3 months',
    'Next 6 months',
    '6–12 months',
    'Exploring',
    'Nothing specific',
    'Overpaying',
    'Hidden costs',
    'Daily traffic',
    'Schools too far',
    'Trusting the builder',
    'Resale value',
    'Not a priority',
    'Yes, factor them in',
    'Whitefield / ITPL',
    'Electronic City',
    'Manyata / North',
    'MG Road / CBD',
    'Not commute-driven',
    'Shorter commute',
    'Staying on budget',
    'About equal',
    'Done',
    // WA minimal-brief rows / buttons (wa-pack) — labels, never places.
    'Help me choose',
    '✨ Help me choose',
    'Choose size',
    'Set budget',
    'Any size',
    'Any budget',
    'Villa',
    'Plot / land',
  ].map((s) => s.toLowerCase()),
);

/** Dynamic WA budget-band labels ("Under ₹85L", "₹85L – ₹1.2 Cr", "Above ₹1.2 Cr"). */
const WA_BUDGET_BAND_RE = /^(?:under|above)?\s*₹\s*[\d.]+\s*(?:l|cr)(?:\s*[–-]\s*₹\s*[\d.]+\s*(?:l|cr))?$/i;

export function isAdvisorBriefChipPhrase(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ADVISOR_BRIEF_CHIP_PHRASES.has(t) || WA_BUDGET_BAND_RE.test(t);
}
