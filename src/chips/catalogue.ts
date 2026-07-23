/**
 * What a predicted state can be OFFERED as, and whether we can back it up.
 *
 * The transition table predicts engine states. Not every state is something a
 * buyer taps: `no_fit` is an outcome, `greet` is ours, `handoff` is a person.
 * This is the filter between "what the buyer will probably do next" and "what
 * we can put on a button" — the ∩ half of
 *
 *     catalogue = states the engine can ANSWER ∩ topics we have evidence for
 *
 * Evidence is checked against the ProjectDetail the turn already loaded, so a
 * chip is never offered for a fact the project does not have. That costs no
 * extra fetch: if the buyer is focused, the detail is in hand.
 *
 * Labels are deliberately the same strings nba.ts already serves. Shadow mode
 * compares what the ranker WOULD show against what the static list DID show,
 * and that comparison is only readable if both speak the same vocabulary.
 */
import type { ProjectDetail } from '../engine/types.js';

export interface ChipEvidence {
  /** The project in focus, if any — its detail is what we check facts against. */
  focused?: ProjectDetail;
  /** How many projects are on the board; some chips need two to make sense. */
  shortlistSize: number;
  /** Whether a visit is already booked — "plan a visit" is noise afterwards. */
  visitBooked?: boolean;
}

export interface ChipDefinition {
  /** The predicted state this chip would satisfy. */
  state: string;
  label: (ev: ChipEvidence) => string;
  /** False when we would be offering a question we cannot answer. */
  available: (ev: ChipEvidence) => boolean;
}

const hasPrice = (p?: ProjectDetail): boolean =>
  !!p?.startingPriceDisplay || !!p?.configurations?.some((c) => c.priceMinInr > 0);

const hasLegal = (p?: ProjectDetail): boolean =>
  !!p?.reraNumber || !!p?.khata || !!p?.ecStatus || !!p?.naStatus;

const hasFaq = (p: ProjectDetail | undefined, ...keys: string[]): boolean =>
  !!p?.faqs?.some((f) => keys.some((k) => f.questionKey.includes(k)));

/**
 * Ordered only for readability — rank() sorts by the table, never by this list.
 */
export const CHIP_CATALOGUE: ChipDefinition[] = [
  {
    state: 'answer/price',
    label: () => 'Starting prices',
    available: (ev) => hasPrice(ev.focused) || (!ev.focused && ev.shortlistSize > 0),
  },
  {
    state: 'answer/availability',
    label: () => 'Unit configurations',
    available: (ev) => (ev.focused?.configurations?.length ?? 0) > 0,
  },
  {
    state: 'answer/legal',
    label: () => 'Legal status',
    available: (ev) => hasLegal(ev.focused) || hasFaq(ev.focused, 'legal', 'rera'),
  },
  {
    state: 'answer/location',
    label: () => 'Location & connectivity',
    available: (ev) => !!ev.focused?.microMarket || hasFaq(ev.focused, 'location', 'connectivity'),
  },
  {
    state: 'answer/amenities',
    label: () => 'Amenities',
    available: (ev) => hasFaq(ev.focused, 'amenit'),
  },
  {
    state: 'answer/emi',
    label: () => 'EMI on this',
    // An EMI needs a number to amortise. No price, no honest EMI.
    available: (ev) => hasPrice(ev.focused),
  },
  {
    state: 'answer/media',
    label: () => 'Photos & floor plans',
    available: (ev) => hasFaq(ev.focused, 'brochure', 'floor', 'media', 'plan'),
  },
  {
    state: 'answer/overview',
    label: (ev) => (ev.focused ? `About ${ev.focused.name}` : 'Tell me more'),
    available: (ev) => !!ev.focused,
  },
  {
    state: 'answer/compare',
    label: (ev) => `Compare all ${Math.min(ev.shortlistSize, 3)}`,
    available: (ev) => ev.shortlistSize >= 2,
  },
  {
    state: 'recommend',
    label: () => 'Show me more projects',
    available: () => true,
  },
  {
    state: 'visit_ask',
    label: () => 'Plan a visit day',
    available: (ev) => !ev.visitBooked && (ev.shortlistSize > 0 || !!ev.focused),
  },
];

const BY_STATE = new Map(CHIP_CATALOGUE.map((c) => [c.state, c]));

/**
 * A state the buyer could not have chosen — outcomes, our own moves, and
 * escalations. Kept explicit so a NEW state defaults to "no chip yet" and
 * shows up in the shadow log as unlabelled, rather than silently vanishing.
 */
export function chipFor(state: string): ChipDefinition | undefined {
  return BY_STATE.get(state);
}
