import type { ChipCatalogEntry, ChipPathId } from './types.js';

/** Closed chip menu — free text resolves into these paths. */
export const CHIP_CATALOG: readonly ChipCatalogEntry[] = [
  {
    id: 'chip.compare',
    label: 'Compare Projects',
    act: 'compare',
    topic: 'compare',
    actionIds: ['compare_projects', 'compare_both', 'compare'],
  },
  {
    id: 'chip.answer.legal',
    label: 'Legal',
    act: 'answer',
    topic: 'legal',
    actionIds: ['answer_legal', 'legal', 'legal_brief'],
  },
  {
    id: 'chip.answer.price',
    label: 'Pricing',
    act: 'answer',
    topic: 'price',
    actionIds: ['answer_price', 'pricing', 'price'],
  },
  {
    id: 'chip.answer.availability',
    label: 'Configurations',
    act: 'answer',
    topic: 'availability',
    actionIds: ['answer_availability', 'configurations', 'units', 'plot_sizes'],
  },
  {
    id: 'chip.answer.media',
    label: 'Brochure',
    act: 'answer',
    topic: 'media',
    actionIds: ['answer_media', 'brochure', 'floor_plan'],
  },
  {
    id: 'chip.answer.emi',
    label: 'EMI',
    act: 'answer',
    topic: 'emi',
    actionIds: ['answer_emi', 'emi'],
  },
  {
    id: 'chip.answer.amenities',
    label: 'Amenities',
    act: 'answer',
    topic: 'amenities',
    actionIds: ['answer_amenities', 'amenities'],
  },
  {
    id: 'chip.answer.location',
    label: 'Location',
    act: 'answer',
    topic: 'location',
    actionIds: ['answer_location', 'location'],
  },
  {
    id: 'chip.answer.overview',
    label: 'Project details',
    act: 'answer',
    topic: 'overview',
    actionIds: ['answer_overview', 'overview', 'details'],
  },
  {
    id: 'chip.visit_book',
    label: 'Book visit',
    act: 'visit_book',
    actionIds: ['visit_book', 'book_visit', 'schedule_visit', 'plan_visit'],
  },
  {
    id: 'chip.visit_recall',
    label: 'My visits',
    act: 'visit_recall',
    actionIds: ['visit_recall', 'my_visits', 'visit_bookings'],
  },
  {
    id: 'chip.search',
    label: 'Show more projects',
    act: 'search',
    actionIds: ['search', 'show_more', 'refine_search', 'continue_search'],
  },
  {
    id: 'chip.object',
    label: 'Objection',
    act: 'object',
    actionIds: ['object', 'objection'],
  },
  {
    id: 'chip.handoff',
    label: 'Talk to human',
    act: 'handoff',
    actionIds: ['handoff', 'talk_to_human', 'callback', 'escalate'],
  },
  {
    id: 'chip.stop',
    label: 'Stop',
    act: 'stop',
    actionIds: ['stop', 'opt_out', 'unsubscribe'],
  },
  {
    id: 'chip.greet',
    label: 'Hi',
    act: 'greet',
    actionIds: ['greet', 'hello'],
  },
] as const;

const BY_ID = new Map<ChipPathId, ChipCatalogEntry>(CHIP_CATALOG.map((e) => [e.id, e]));

const BY_ACTION = new Map<string, ChipCatalogEntry>();
for (const e of CHIP_CATALOG) {
  for (const aid of e.actionIds ?? []) {
    BY_ACTION.set(aid.toLowerCase(), e);
  }
  BY_ACTION.set(e.id.toLowerCase(), e);
}

export function catalogEntry(id: ChipPathId): ChipCatalogEntry | undefined {
  return BY_ID.get(id);
}

export function catalogEntryByActionId(actionId: string): ChipCatalogEntry | undefined {
  return BY_ACTION.get(actionId.trim().toLowerCase());
}
