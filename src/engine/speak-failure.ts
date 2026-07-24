import type { Failure } from './outcome.js';

export interface SpeakContext {
  subjectLabel?: string;
  buyerValue?: string;
  readings?: readonly [string, string];
  alternatives?: readonly string[];
}

const UNSUPPORTED_COPY: Readonly<Record<string, string>> = Object.freeze({
  protected_identity_filter:
    "I can't help filter homes or communities by caste or religion. I can help with location, budget, home type, amenities, or commute instead.",
  investment_return:
    "I can share project prices and factual details, but I can't calculate or promise CAGR, IRR, or investment returns.",
  discount:
    "I can share the listed price and cost details, but I can't promise or negotiate a discount. I can arrange a callback with the sales team.",
  internal_instructions:
    "I can explain how I help with property search, but I can't share private system instructions or internal configuration.",
  bhk:
    'BHK means Bedroom, Hall, and Kitchen. For example, a 2 BHK has two bedrooms, one living hall, and a kitchen.',
  ready_to_move:
    "Ready-to-move means construction is complete and the home is available for possession, subject to the project's approvals and handover status.",
  identity:
    "I'm Naya, an AI property advisor. I can help you discover projects, compare factual details, and plan visits.",
  data_collection:
    'I use the details you share to help with your property search and follow-up. You can ask me to stop contact or delete your details at any time.',
  unknown_request:
    "I'm not sure what you'd like help with. Could you rephrase it in one sentence?",
});

/**
 * The sole failure-to-copy boundary.
 *
 * Phase 0 does not call this function. The strings remain inert until the
 * owning behavior phase is reviewed and enabled.
 */
export function speakFailure(failure: Failure, ctx: SpeakContext = {}): string {
  const subject = ctx.subjectLabel || failure.subject.replace(/[._]/g, ' ');

  switch (failure.kind) {
    case 'missing_input':
      return `I need ${subject} before I can work that out.`;
    case 'no_data':
      return `I don't have ${subject} on file.${ctx.alternatives?.length ? ` I do have ${ctx.alternatives.join(' and ')}.` : ''}`;
    case 'no_match':
      return failure.nearest
        ? `Nothing matches ${ctx.buyerValue || subject} exactly. Closest is ${failure.nearest.name} — ${failure.nearest.display}.`
        : `Nothing matches ${ctx.buyerValue || subject} exactly.`;
    case 'relaxed':
      return `I couldn't match ${ctx.buyerValue || subject} exactly, so these are broader options.`;
    case 'unresolvable':
      if (failure.subject === 'locality') {
        return "I couldn't identify that location. Could you name a city or locality?";
      }
      return `I couldn't identify ${ctx.buyerValue || subject}.`;
    case 'unsupported':
      return UNSUPPORTED_COPY[failure.subject] ?? `I can't help with ${subject}.`;
    case 'ambiguous':
      if (ctx.readings) {
        return `Just so I get this right — do you want me to ${ctx.readings[0]}, or ${ctx.readings[1]}?`;
      }
      return `I want to make sure I understood ${subject} correctly.`;
  }
}
