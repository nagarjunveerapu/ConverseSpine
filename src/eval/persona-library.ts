/** Curated eval scenarios — cover Naya-parity journeys per builder. */
import type { BuilderCatalog } from './catalog.js';
import type { BuyerProfile } from './personas.js';

export type ScenarioId =
  | 'discovery'
  | 'named_project'
  | 'compare_two'
  | 'compare_three'
  | 'pricing'
  | 'unit_configs'
  | 'brochure'
  | 'floor_plan'
  | 'legal_rera'
  | 'objection'
  | 'visit_single'
  | 'visit_multi'
  | 'hinglish';

export interface ScenarioDef {
  id: ScenarioId;
  name: string;
  goal: string;
  style: BuyerProfile['style'];
  purpose: BuyerProfile['purpose'];
  bhk: string;
  budget: string;
  location: string;
  project_interest?: string;
  /** Deterministic buyer script — one message per turn. */
  script: string[];
}

const LOKATIONS_SCENARIOS: ScenarioDef[] = [
  {
    id: 'discovery',
    name: 'Plantation discovery',
    goal: 'Discover plantation options within budget and shortlist',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '80 lakh',
    location: 'Sakleshpur',
    script: ['hi', 'Sakleshpur 80 lakh plantation investment', 'show me options', '[DONE]'],
  },
  {
    id: 'named_project',
    name: 'Ayana deep-dive',
    goal: 'Learn about Ayana, get pricing, book visit',
    style: 'chatty',
    purpose: 'investment',
    bhk: '—',
    budget: '50 lakh',
    location: 'Sakleshpur',
    project_interest: 'Ayana',
    script: ['hi', 'tell me about Ayana', 'price details please', 'i would like a site visit saturday', 'yes', '[DONE]'],
  },
  {
    id: 'compare_two',
    name: 'Compare estates',
    goal: 'Compare Ayana vs Krishnaja Greens side by side',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '1 cr',
    location: 'Coorg',
    script: ['hi', 'compare Ayana and Krishnaja Greens', 'which one is better for investment?', '[DONE]'],
  },
  {
    id: 'pricing',
    name: 'Krishnaja pricing',
    goal: 'Get full pricing breakdown for Krishnaja Greens',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '40 lakh',
    location: 'Virajpet',
    project_interest: 'Krishnaja Greens',
    script: ['hi', 'tell me about Krishnaja Greens', 'price details please', 'what are the cost components?', '[DONE]'],
  },
  {
    id: 'unit_configs',
    name: 'Plot configurations',
    goal: 'Ask what plot sizes and configurations Ayana offers',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '30 lakh',
    location: 'Sakleshpur',
    project_interest: 'Ayana',
    script: ['hi', 'tell me about Ayana', 'what plot sizes and configurations do you have?', '[DONE]'],
  },
  {
    id: 'brochure',
    name: 'Brochure request',
    goal: 'Get project brochure for Ayana',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '50 lakh',
    location: 'Sakleshpur',
    project_interest: 'Ayana',
    script: ['hi', 'tell me about Ayana', 'please send me the brochure', '[DONE]'],
  },
  {
    id: 'legal_rera',
    name: 'Legal / RERA',
    goal: 'Get RERA and legal info before committing',
    style: 'skeptical',
    purpose: 'investment',
    bhk: '—',
    budget: '60 lakh',
    location: 'Virajpet',
    project_interest: 'Krishnaja Greens',
    script: ['hi', 'tell me about Krishnaja Greens', 'what is the RERA status?', '[DONE]'],
  },
  {
    id: 'objection',
    name: 'Price objection',
    goal: 'Push back on price but still explore visit',
    style: 'skeptical',
    purpose: 'investment',
    bhk: '—',
    budget: '25 lakh',
    location: 'Sakleshpur',
    project_interest: 'Ayana',
    script: ['hi', 'tell me about Ayana', 'price details please', 'bit too expensive for me', 'still want a site visit saturday', 'yes', '[DONE]'],
  },
  {
    id: 'visit_multi',
    name: 'Multi-project visits',
    goal: 'Book visits to two different projects',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '1 cr',
    location: 'Coorg',
    script: [
      'hi',
      'show me options',
      'tell me about Ayana',
      'site visit saturday for Ayana',
      'yes',
      'tell me about Krishnaja Greens',
      'site visit sunday for Krishnaja Greens',
      'yes',
      '[DONE]',
    ],
  },
  {
    id: 'hinglish',
    name: 'Hinglish buyer',
    goal: 'Hinglish discovery through pricing',
    style: 'hinglish',
    purpose: 'investment',
    bhk: '—',
    budget: '40 lakh',
    location: 'Sakleshpur',
    script: ['namaste', 'Sakleshpur mein 40 lakh budget hai plantation ke liye', 'options dikhao', 'Ayana ke baare mein batao', 'pricing batao', '[DONE]'],
  },
  {
    id: 'compare_three',
    name: 'Full catalog orientation',
    goal: 'List all options then compare top picks',
    style: 'chatty',
    purpose: 'investment',
    bhk: '—',
    budget: '1 cr',
    location: 'Coorg',
    script: ['hi', 'show me all plantation options', 'compare Ayana and Krishnaja Greens', '[DONE]'],
  },
  {
    id: 'visit_single',
    name: 'Quick visit book',
    goal: 'Fast path from list to confirmed visit',
    style: 'direct',
    purpose: 'investment',
    bhk: '—',
    budget: '50 lakh',
    location: 'Virajpet',
    script: ['hi', 'Virajpet 50 lakh plantation', 'tell me about Krishnaja Greens', 'book site visit tomorrow', 'yes', '[DONE]'],
  },
];

const BRIGADE_SCENARIOS: ScenarioDef[] = [
  {
    id: 'discovery',
    name: 'Apartment discovery',
    goal: 'Find 3 BHK in Whitefield within budget',
    style: 'direct',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1.2 cr',
    location: 'Whitefield',
    script: ['hi', '3 BHK Whitefield 1.2 cr', 'show me options', '[DONE]'],
  },
  {
    id: 'named_project',
    name: 'Utopia deep-dive',
    goal: 'Learn about Cornerstone Utopia, pricing, visit',
    style: 'chatty',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1.5 cr',
    location: 'Whitefield',
    project_interest: 'Cornerstone Utopia',
    script: ['hi', 'tell me about Cornerstone Utopia', 'price details please', 'site visit saturday', 'yes', '[DONE]'],
  },
  {
    id: 'compare_two',
    name: 'Compare Whitefield vs Sarjapur',
    goal: 'Compare Utopia and Sanctuary',
    style: 'direct',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1 cr',
    location: 'Bangalore',
    script: ['hi', 'compare Cornerstone Utopia and Brigade Sanctuary', 'which is better for families?', '[DONE]'],
  },
  {
    id: 'compare_three',
    name: 'Airport corridor compare',
    goal: 'Compare three Devanahalli projects',
    style: 'direct',
    purpose: 'investment',
    bhk: '2 BHK',
    budget: '80 lakh',
    location: 'Devanahalli',
    script: ['hi', 'compare Brigade Eldorado, Brigade Orchards and Brigade Oasis', '[DONE]'],
  },
  {
    id: 'unit_configs',
    name: 'BHK configurations',
    goal: 'Ask available 2 BHK and 3 BHK configurations',
    style: 'direct',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1 cr',
    location: 'Whitefield',
    project_interest: 'Cornerstone Utopia',
    script: ['hi', 'tell me about Cornerstone Utopia', 'what 2 BHK and 3 BHK configurations are available?', '[DONE]'],
  },
  {
    id: 'brochure',
    name: 'Brochure request',
    goal: 'Get brochure for Eldorado',
    style: 'direct',
    purpose: 'investment',
    bhk: '2 BHK',
    budget: '50 lakh',
    location: 'Devanahalli',
    project_interest: 'Brigade Eldorado',
    script: ['hi', 'tell me about Brigade Eldorado', 'send me the brochure please', '[DONE]'],
  },
  {
    id: 'floor_plan',
    name: 'Floor plan request',
    goal: 'Request floor plan for 3 BHK',
    style: 'direct',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1.2 cr',
    location: 'Whitefield',
    project_interest: 'Cornerstone Utopia',
    script: ['hi', 'tell me about Cornerstone Utopia', 'can I see the 3 BHK floor plan?', '[DONE]'],
  },
  {
    id: 'pricing',
    name: 'Full pricing breakdown',
    goal: 'Detailed pricing for Meadows',
    style: 'direct',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '90 lakh',
    location: 'Kanakapura Road',
    project_interest: 'Brigade Meadows',
    script: ['hi', 'tell me about Brigade Meadows', 'price details please', '[DONE]'],
  },
  {
    id: 'legal_rera',
    name: 'RERA check',
    goal: 'Verify RERA before visit',
    style: 'skeptical',
    purpose: 'self_use',
    bhk: '2 BHK',
    budget: '70 lakh',
    location: 'Sarjapur',
    project_interest: 'Brigade Sanctuary',
    script: ['hi', 'tell me about Brigade Sanctuary', 'is it RERA registered?', '[DONE]'],
  },
  {
    id: 'objection',
    name: 'Location objection',
    goal: 'Push back on distance, still get options',
    style: 'skeptical',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1 cr',
    location: 'Devanahalli',
    project_interest: 'Brigade Eldorado',
    script: ['hi', 'tell me about Brigade Eldorado', 'seems too far from city', 'show me closer options', '[DONE]'],
  },
  {
    id: 'visit_multi',
    name: 'Two project visits',
    goal: 'Book visits to Utopia and Sanctuary',
    style: 'direct',
    purpose: 'self_use',
    bhk: '3 BHK',
    budget: '1.2 cr',
    location: 'Whitefield',
    script: [
      'hi',
      '3 BHK Whitefield 1.2 cr',
      'tell me about Cornerstone Utopia',
      'site visit saturday',
      'yes',
      'tell me about Brigade Sanctuary',
      'site visit sunday',
      'yes',
      '[DONE]',
    ],
  },
  {
    id: 'hinglish',
    name: 'Hinglish apartment buyer',
    goal: 'Hinglish search through pricing',
    style: 'hinglish',
    purpose: 'self_use',
    bhk: '2 BHK',
    budget: '80 lakh',
    location: 'Devanahalli',
    script: ['hi', 'Devanahalli mein 2 BHK chahiye budget 80 lakh', 'options dikhao', 'Eldorado ke baare mein batao', 'pricing?', '[DONE]'],
  },
];

export function scenarioPersonas(builderId: string, catalog?: BuilderCatalog): BuyerProfile[] {
  const defs = builderId === 'brigade-group' ? BRIGADE_SCENARIOS : LOKATIONS_SCENARIOS;
  return defs.map((s, i) => ({
    id: `${builderId}-${s.id}`,
    name: s.name,
    phone: `+9198${builderId === 'brigade-group' ? '2' : '1'}${String(i).padStart(2, '0')}00000`,
    builder_id: builderId,
    goal: s.goal,
    bhk: s.bhk,
    budget: s.budget,
    location: s.location,
    purpose: s.purpose,
    style: s.style,
    project_interest: s.project_interest,
    max_turns: s.script.length + 2,
    catalog_kind: builderId === 'lokations' ? 'plantation' : 'apartment',
    scenario_id: s.id,
    script: s.script,
  }));
}

export function allBuilderIds(): string[] {
  return ['lokations', 'brigade-group'];
}
