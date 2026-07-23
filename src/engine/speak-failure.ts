import type { Failure } from './outcome.js';

export interface SpeakContext {
  subjectLabel?: string;
  buyerValue?: string;
  readings?: readonly [string, string];
}

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
      return `I don't have ${subject} on file.`;
    case 'no_match':
      return failure.nearest
        ? `Nothing matches ${ctx.buyerValue || subject} exactly. Closest is ${failure.nearest.name} — ${failure.nearest.display}.`
        : `Nothing matches ${ctx.buyerValue || subject} exactly.`;
    case 'relaxed':
      return `I couldn't match ${ctx.buyerValue || subject} exactly, so these are broader options.`;
    case 'unresolvable':
      return `I couldn't identify ${ctx.buyerValue || subject}.`;
    case 'unsupported':
      return `I can't help with ${subject}.`;
    case 'ambiguous':
      if (ctx.readings) {
        return `Just so I get this right — do you want me to ${ctx.readings[0]}, or ${ctx.readings[1]}?`;
      }
      return `I want to make sure I understood ${subject} correctly.`;
  }
}
