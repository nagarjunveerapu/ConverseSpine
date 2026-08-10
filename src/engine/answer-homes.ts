/**
 * Answer-map singular homes — closed template ids + next-probe rank.
 * Desk Ops teaches homes→binds; Spine picks template skeleton + probe chips.
 *
 * Design note (pre-code):
 * - Files: this module; nba.ts consumes probe labels for answer goals.
 * - Why: align chip vocabulary with singular homes (Place, Pricing, Visit…),
 *   not compound “Location & connectivity” FAQ filing.
 * - Why not: compose regex, RTI, or FAQ paste — atoms already drive location/price lines.
 * - Consumers: chipsForGoal (answer/location, answer/price).
 * - Quality: VIS-ADX-06 + location/connectivity turns.
 */

export type AnswerHomeId =
  | 'place'
  | 'connectivity'
  | 'pricing'
  | 'configs'
  | 'legal'
  | 'possession'
  | 'payment_plan'
  | 'charges'
  | 'media'
  | 'visit'
  | 'amenities'
  | 'banks'
  | 'other';

export function templateIdForHomes(homes: AnswerHomeId[]): string {
  const active = homes.filter((h) => h !== 'other').slice().sort();
  if (active.length === 0) return 'faq_escape.v1';
  return `${active.join('+')}.v1`;
}

/** Deterministic next-probe after delivered homes. */
export function rankNextProbe(
  delivered: AnswerHomeId[],
): { primary: AnswerHomeId; chips: AnswerHomeId[] } {
  const done = new Set(delivered.filter((h) => h !== 'other'));
  const pool: AnswerHomeId[] = [
    'visit',
    'pricing',
    'payment_plan',
    'configs',
    'legal',
    'possession',
    'connectivity',
    'place',
    'media',
    'amenities',
    'banks',
  ];
  const chips = pool.filter((h) => !done.has(h)).slice(0, 4);
  return { primary: chips[0] ?? 'visit', chips: chips.length ? chips : ['visit'] };
}

/** Labels must resolve via speech-act free-text / catalog (tap → same home). */
export function probeChipLabel(home: AnswerHomeId, delivered: AnswerHomeId[] = []): string {
  if (home === 'visit') return 'Plan a visit day';
  if (home === 'pricing') return 'Pricing';
  // After connectivity delivered, schools is still a location facet ask.
  if (home === 'connectivity' && delivered.includes('connectivity')) return 'Connectivity';
  if (home === 'connectivity') return 'Connectivity';
  if (home === 'legal') return 'Legal';
  if (home === 'payment_plan') return 'Payment plan';
  if (home === 'configs') return 'Configurations';
  if (home === 'possession') return 'Possession';
  if (home === 'media') return 'Brochure';
  if (home === 'amenities') return 'Amenities';
  if (home === 'banks') return 'What banks?';
  if (home === 'place') return 'Location';
  if (home === 'charges') return 'Pricing';
  return 'Other';
}

/** Map answer topic → homes just delivered (for probe rank). */
export function homesForAnswerTopic(topic: string | undefined): AnswerHomeId[] {
  switch (topic) {
    case 'location':
      return ['place', 'connectivity'];
    case 'price':
    case 'emi':
      return ['pricing'];
    case 'availability':
    case 'property_type':
      return ['configs'];
    case 'legal':
      return ['legal'];
    case 'amenities':
      return ['amenities'];
    case 'media':
      return ['media'];
    default:
      return [];
  }
}

/** NBA chip labels after an answer turn — singular-home vocabulary. */
export function nextProbeChipLabels(topic: string | undefined): string[] {
  const delivered = homesForAnswerTopic(topic);
  if (!delivered.length) return [];
  const { chips } = rankNextProbe(delivered);
  return chips.map((h) => probeChipLabel(h, delivered));
}
