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
 * Availability is THREE-valued, and that is not fussiness. The turn attaches a
 * full ProjectDetail only when it needed one; a price answered from a cost
 * sheet leaves `evidence.detail` empty. Collapsing that into "no" produced
 * turns with zero chips on dev — the engine reporting a project has no price
 * immediately after quoting its price. "We did not look" is a different claim
 * from "it is not there", and only one of them should silence a chip.
 *
 * Labels are deliberately the same strings nba.ts already serves, so shadow
 * mode compares like with like.
 */
import type { ProjectDetail } from '../engine/types.js';

/** yes = we hold the fact · no = the project genuinely lacks it · unknown = not loaded. */
export type Availability = 'yes' | 'no' | 'unknown';

export interface ChipEvidence {
  /** Detail for the project in focus — present only when the turn hydrated it. */
  focused?: ProjectDetail;
  /** Name of the project in focus even when its detail was not loaded. */
  focusName?: string;
  /** Names on the board, best first. */
  shortlist: readonly string[];
  visitBooked?: boolean;
}

export interface ChipDefinition {
  state: string;
  label: (ev: ChipEvidence) => string;
  available: (ev: ChipEvidence) => Availability;
}

/** A project is in play but we never loaded its facts — say so, do not guess. */
const unchecked = (ev: ChipEvidence): boolean => !ev.focused && !!ev.focusName;

const factCheck = (ev: ChipEvidence, held: boolean): Availability => {
  if (ev.focused) return held ? 'yes' : 'no';
  return unchecked(ev) ? 'unknown' : 'no';
};

const hasPrice = (p: ProjectDetail): boolean =>
  !!p.startingPriceDisplay || !!p.configurations?.some((c) => c.priceMinInr > 0);

const hasLegal = (p: ProjectDetail): boolean =>
  !!p.reraNumber || !!p.khata || !!p.ecStatus || !!p.naStatus;

const hasFaq = (p: ProjectDetail, ...keys: string[]): boolean =>
  !!p.faqs?.some((f) => keys.some((k) => f.questionKey.includes(k)));

/** Ordered only for readability — rank() sorts by the table, never by this list. */
export const CHIP_CATALOGUE: ChipDefinition[] = [
  {
    state: 'answer/price',
    label: () => 'Starting prices',
    // On the board rather than in a project, prices are the shortlist's.
    available: (ev) =>
      ev.focused ? (hasPrice(ev.focused) ? 'yes' : 'no')
      : ev.focusName ? 'unknown'
      : ev.shortlist.length > 0 ? 'yes' : 'no',
  },
  {
    state: 'answer/availability',
    label: () => 'Unit configurations',
    available: (ev) => factCheck(ev, (ev.focused?.configurations?.length ?? 0) > 0),
  },
  {
    state: 'answer/legal',
    label: () => 'Legal status',
    available: (ev) =>
      factCheck(ev, !!ev.focused && (hasLegal(ev.focused) || hasFaq(ev.focused, 'legal', 'rera'))),
  },
  {
    state: 'answer/location',
    label: () => 'Location & connectivity',
    available: (ev) =>
      factCheck(
        ev,
        !!ev.focused && (!!ev.focused.microMarket || hasFaq(ev.focused, 'location', 'connectivity')),
      ),
  },
  {
    state: 'answer/amenities',
    label: () => 'Amenities',
    available: (ev) => factCheck(ev, !!ev.focused && hasFaq(ev.focused, 'amenit')),
  },
  {
    state: 'answer/emi',
    label: () => 'EMI on this',
    // An EMI needs a number to amortise. No price, no honest EMI.
    available: (ev) => factCheck(ev, !!ev.focused && hasPrice(ev.focused)),
  },
  {
    state: 'answer/media',
    label: () => 'Photos & floor plans',
    available: (ev) =>
      factCheck(ev, !!ev.focused && hasFaq(ev.focused, 'brochure', 'floor', 'media', 'plan')),
  },
  {
    state: 'answer/overview',
    // After a recommend there is no focus yet — the overview the buyer wants
    // is of the first project on the board, and naming it is the whole chip.
    label: (ev) => {
      const name = ev.focusName ?? ev.focused?.name ?? ev.shortlist[0];
      return name ? `Tell me about ${name}` : 'Tell me more';
    },
    available: (ev) => (ev.focusName || ev.focused || ev.shortlist.length ? 'yes' : 'no'),
  },
  {
    state: 'answer/compare',
    label: (ev) => `Compare all ${Math.min(ev.shortlist.length, 3)}`,
    available: (ev) => (ev.shortlist.length >= 2 ? 'yes' : 'no'),
  },
  {
    state: 'recommend',
    label: () => 'Show me more projects',
    available: () => 'yes',
  },
  {
    state: 'visit_ask',
    label: () => 'Plan a visit day',
    available: (ev) =>
      ev.visitBooked ? 'no' : ev.shortlist.length > 0 || ev.focusName || ev.focused ? 'yes' : 'no',
  },
];

const BY_STATE = new Map(CHIP_CATALOGUE.map((c) => [c.state, c]));

/**
 * Undefined for states a buyer could not have chosen — outcomes, our own
 * moves, escalations. Kept implicit so a NEW state defaults to "no chip yet"
 * and surfaces in the shadow log as unlabelled rather than silently vanishing.
 */
export function chipFor(state: string): ChipDefinition | undefined {
  return BY_STATE.get(state);
}
