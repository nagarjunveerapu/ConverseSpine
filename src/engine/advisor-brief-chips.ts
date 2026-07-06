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
  ].map((s) => s.toLowerCase()),
);

export function isAdvisorBriefChipPhrase(text: string): boolean {
  return ADVISOR_BRIEF_CHIP_PHRASES.has(text.trim().toLowerCase());
}
