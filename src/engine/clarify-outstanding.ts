/**
 * Sticky clarify — when the buyer sends noise / unbindable text, re-anchor to
 * the outstanding job (discover brief, focused facet, visit ask). Not a teach
 * kind: smash/smalltalk stays placeability + copy.
 */
import type { Constraints, Phase, VisitState } from './types.js';

export interface StickyClarifyInput {
  phase: Phase;
  visit?: VisitState;
  focusName?: string;
  /** Newest prior answer topics (e.g. legal, amenities). */
  priorTopics?: readonly string[];
  constraints?: Constraints;
  /** advisor_web → slightly less form-clerk tone. */
  channel?: 'whatsapp' | 'advisor_web';
}

/** Null → caller keeps generic unknown_request / clarify copy. */
export function speakStickyClarify(input: StickyClarifyInput): string | null {
  const advisor = input.channel === 'advisor_web';

  if (input.phase === 'visit') {
    const ask = input.visit?.lastAsk;
    if (ask === 'origin' || (input.visit?.originAsked && !input.visit?.originText)) {
      return advisor
        ? "I couldn't make sense of that for planning. Still need your starting area so I can sequence the stops — e.g. Indiranagar or Whitefield?"
        : "I couldn't make sense of that. To plan your visits in order, I need a starting area — " +
            'e.g. Indiranagar or Whitefield. Where will you be coming from?';
    }
    if (ask === 'day' || ask === 'time' || ask === 'window' || ask === 'same_day_choice') {
      const name = input.visit?.projectName ? ` for *${input.visit.projectName}*` : '';
      return advisor
        ? `I couldn't make sense of that. Still choosing a day/time${name} — Saturday morning or Monday 11am both work as examples.`
        : `I couldn't make sense of that. Still picking a day/time${name} — ` +
            'for example Saturday morning, or Monday 11am.';
    }
    if (ask === 'which_projects') {
      return advisor
        ? "I couldn't make sense of that. Which projects should we visit — numbers, names, or both?"
        : "I couldn't make sense of that. Which projects should we visit — reply with numbers or names " +
            '(e.g. 1 and 2, or both).';
    }
  }

  if (input.phase === 'focused' && input.focusName) {
    const topic = (input.priorTopics?.[0] ?? '').toLowerCase();
    if (topic === 'legal') {
      return (
        `I couldn't make sense of that. Still on legal for *${input.focusName}* — ` +
        'ask about RERA, OC, khata, or title, or name what you need next.'
      );
    }
    if (topic === 'amenities') {
      return (
        `I couldn't make sense of that. Still on amenities for *${input.focusName}* — ` +
        'what would you like to know, or ask about price/legal next.'
      );
    }
    if (topic === 'price') {
      return (
        `I couldn't make sense of that. Still on pricing for *${input.focusName}* — ` +
        'ask for a breakdown, or name another detail you need.'
      );
    }
    return (
      `I couldn't make sense of that. Still looking at *${input.focusName}* — ` +
      'ask about price, legal, amenities, or what you need next.'
    );
  }

  if (input.phase === 'discover' || input.phase === 'handoff') {
    const c = input.constraints ?? {};
    const bits: string[] = [];
    if (!c.location) bits.push('locality');
    if (!c.budgetMaxInr) bits.push('budget');
    if (!c.bhk && c.purpose !== 'investment') bits.push('BHK');
    const need = bits.length ? bits.slice(0, 3).join(', ') : 'locality, budget, or BHK';
    return advisor
      ? `I couldn't make sense of that. Tell me in your own words what you're looking for — ${need} helps me shortlist well.`
      : "I couldn't make sense of that. I can help you pick the right property — " +
          `please share your ${need}?`;
  }

  return null;
}
