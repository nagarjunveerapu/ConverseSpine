import type { Failure } from './outcome.js';

export interface SpeakContext {
  /** Human label for the failed subject (e.g. "carpet area", loan amount). */
  subjectLabel?: string;
  /** Focused project name for intel-gated declines — never used as the subject. */
  projectName?: string;
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
 * Atoms the engine refuses to answer from an unsourced row, so `no_data` here
 * means "I won't quote this", not "nobody wrote it down".
 *
 * `turn.ts` blocks `rental_yield` / `resale_value` from the project-FAQ path
 * (C1) because those rows carry ESTIMATES with a third-party citation —
 * "Estimated 3-4% net rental yield … per recent Magicbricks" — and a bot
 * repeating that is giving investment advice. 16 such rows exist on dev; the
 * intended substitute is approved corridor rent bands or the builder's own
 * stated ROI, and when neither is on the detail the contract fails `no_data`.
 *
 * The guard is right. The generic sentence was not: "I don't have rental yield
 * on file" asserts an absence, so the buyer reads it as a data gap and we look
 * thinner than we are. State the real reason instead — the refusal is the
 * product, and hiding it behind a shrug spends the credibility it earns.
 */
/**
 * Subjects whose decline carries a policy reason, so they can never be folded
 * into the generic "I don't have X on file" sentence.
 */
export function intelGatedSubject(subject: string): boolean {
  return subject === 'rental_yield' || subject === 'appreciation';
}

/** Intel-gated declines — keep the policy reason; name the focused project when known. */
function intelGatedCopy(subject: string, projectName?: string): string | undefined {
  const named = (projectName ?? '').trim();
  if (!intelGatedSubject(subject)) return undefined;
  if (subject === 'rental_yield') {
    return named
      ? `I don't quote a rental-yield figure I can't source for *${named}* — that means approved rent data for the corridor or the builder's own stated return, and I have neither.`
      : "I don't quote a rental-yield figure I can't source — that means approved rent data for the corridor or the builder's own stated return, and I have neither for this one.";
  }
  if (subject === 'appreciation') {
    return named
      ? `I don't have sourced price-trend data for *${named}*'s corridor, and I won't put a number on it without one.`
      : "I don't have sourced price-trend data for this corridor, and I won't put a number on it without one.";
  }
  return undefined;
}

/**
 * The sole failure-to-copy boundary.
 *
 * (The old note here said Phase 0 does not call this and the strings stay
 * inert. It is stale — `turn.ts` speaks it on the ingress, unsupported,
 * clarify and terminal-failure paths, so every string below is live copy.)
 */
export function speakFailure(failure: Failure, ctx: SpeakContext = {}): string {
  const subject = ctx.subjectLabel || failure.subject.replace(/[._]/g, ' ');

  switch (failure.kind) {
    case 'missing_input':
      return `I need ${subject} before I can work that out.`;
    case 'no_data': {
      if (failure.subject === 'education_explainer') {
        return "I don't have a short explainer for that yet — ask me about property types, buying steps, or buyer documents, or name a project.";
      }
      const gated = intelGatedCopy(failure.subject, ctx.projectName);
      if (gated) {
        return `${gated}${ctx.alternatives?.length ? ` I do have ${ctx.alternatives.join(' and ')}.` : ''}`;
      }
      return `I don't have ${subject} on file.${ctx.alternatives?.length ? ` I do have ${ctx.alternatives.join(' and ')}.` : ''}`;
    }
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
