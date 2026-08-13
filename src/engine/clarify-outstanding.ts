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

  // Inside a project we know exactly what is on the table, so a short buyer
  // message ("??") is not a failure to announce — it is a cue to say plainly
  // where we are and name the choices. "I couldn't make sense of that" put the
  // blame on the buyer for a turn the bot had already fumbled.
  if (input.phase === 'focused' && input.focusName) {
    const topic = (input.priorTopics?.[0] ?? '').toLowerCase();
    if (topic === 'legal') {
      return (
        `We're on the legal papers for *${input.focusName}*. ` +
        'I can pull the RERA number, the OC status, the khata, or the title — say which.'
      );
    }
    if (topic === 'amenities') {
      return (
        `We're on amenities for *${input.focusName}*. ` +
        "I can tell you what's built and what's promised — or move to price or the legal papers."
      );
    }
    if (topic === 'price') {
      return (
        `We're on pricing for *${input.focusName}*. ` +
        'I can break the cost down by size, work out the all-in figure, or show the monthly EMI — which one?'
      );
    }
    return (
      `Let me put that plainly — we're on *${input.focusName}*. ` +
      'I can give you the price, the legal papers, the amenities, or put a site visit on the calendar. Which one?'
    );
  }

  if (input.phase === 'discover' || input.phase === 'handoff') {
    const c = input.constraints ?? {};
    const bits: string[] = [];
    if (!c.location) bits.push('locality');
    if (!c.budgetMaxInr) bits.push('budget');
    if (!c.bhk && c.purpose !== 'investment') bits.push('BHK');
    // Brief already filled — never invent "locality, budget, or BHK" as a re-probe.
    if (!bits.length) {
      return advisor
        ? "I couldn't make sense of that. Your brief is already on file — pick a match on the board, or tell me what to change."
        : "I couldn't make sense of that. I've got your brief — want me to show matches again, or open one by name?";
    }
    const need = bits.slice(0, 3).join(', ');
    return advisor
      ? `I couldn't make sense of that. Tell me in your own words what you're looking for — ${need} helps me shortlist well.`
      : "I couldn't make sense of that. I can help you pick the right property — " +
          `please share your ${need}?`;
  }

  return null;
}
