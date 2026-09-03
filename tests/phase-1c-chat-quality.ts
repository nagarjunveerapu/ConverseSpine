/**
 * Reply-quality graders for Phase 1c adversarial journeys.
 * Store invariants are necessary; these catch "passed state, failed conversation."
 */
import type { ThreadState } from '../src/engine/types.js';
import { currentShortlist, discussedList, focusedRef } from '../src/engine/entity-store.js';

export type QualityFail = { turn: string; reason: string; reply: string };

/** Names the buyer can reasonably expect on a compare / both turn. */
export function discourseNames(s: ThreadState): string[] {
  const names = new Set<string>();
  for (const o of currentShortlist(s)) names.add(o.name);
  for (const d of discussedList(s)) names.add(d.name);
  const f = focusedRef(s);
  if (f) names.add(f.projectName);
  return [...names];
}

export function gradeOtherOne(args: {
  buyer: string;
  reply: string;
  before: ThreadState;
  after: ThreadState;
}): QualityFail | null {
  const beforeNames = discourseNames(args.before).filter(
    (n) => n !== focusedRef(args.before)?.projectName,
  );
  const reply = args.reply.toLowerCase();
  if (beforeNames.length === 0) {
    // Only one project in discourse — must not pretend a switch happened.
    if (focusedRef(args.after)?.projectId !== focusedRef(args.before)?.projectId) {
      return {
        turn: args.buyer,
        reason: 'switched focus when there was no alternate discourse project',
        reply: args.reply,
      };
    }
    // Must acknowledge scarcity — not recycle the same overview as a "switch".
    const acknowledges =
      /\b(?:only|just)\s+(?:one|this|got|opened)|no\s+other|no\s+earlier|which\s+(?:one|project)|only\s+\*?ayana|find another(?: option)?|dig deeper/i.test(
        args.reply,
      );
    const recycledOverview =
      /\bquarter acre\b/i.test(args.reply) && /\bwant pricing details\b/i.test(args.reply);
    if (recycledOverview && !acknowledges) {
      return {
        turn: args.buyer,
        reason: '"the other one" with a 1-project board recycled overview instead of clarifying',
        reply: args.reply,
      };
    }
    return null;
  }
  // Alternate exists — must land on it.
  const afterFocus = focusedRef(args.after)?.projectName?.toLowerCase() ?? '';
  const hit = beforeNames.some((n) => afterFocus.includes(n.toLowerCase().split(/\s+/)[0]!));
  if (!hit && !beforeNames.some((n) => reply.includes(n.toLowerCase().split(/\s+/)[0]!))) {
    return {
      turn: args.buyer,
      reason: `expected switch/mention of alternate (${beforeNames.join(', ')}); stayed on ${focusedRef(args.after)?.projectName ?? 'none'}`,
      reply: args.reply,
    };
  }
  return null;
}

export function gradeCompareBoth(args: {
  buyer: string;
  reply: string;
  state: ThreadState;
}): QualityFail | null {
  const names = discourseNames(args.state);
  const reply = args.reply.toLowerCase();
  if (names.length < 2) {
    const clarifies =
      /\b(?:only|just)\s+(?:one|opened)|need\s+(?:another|a second)|name another|pull a second|which\s+two|nothing\s+to\s+compare|one\s+project/i.test(
        args.reply,
      );
    const fakeCompare =
      /\bcompare\b/i.test(args.buyer) &&
      /\bquarter acre\b/i.test(args.reply) &&
      !clarifies;
    if (fakeCompare) {
      return {
        turn: args.buyer,
        reason: '"compare both" with <2 discourse projects recycled a single-project overview',
        reply: args.reply,
      };
    }
    if (!clarifies && /\bcompare\b/i.test(args.buyer)) {
      return {
        turn: args.buyer,
        reason: '"compare both" with <2 projects must clarify — got neither clarify nor a real compare',
        reply: args.reply,
      };
    }
    return null;
  }
  // Need both names (or distinctive tokens) in the reply.
  const mentioned = names.filter((n) => {
    const tok = n.toLowerCase().replace(/^(brigade|lokations)\s+/, '').split(/\s+/)[0]!;
    return tok.length >= 4 && reply.includes(tok);
  });
  if (mentioned.length < 2) {
    return {
      turn: args.buyer,
      reason: `"compare both" must name ≥2 discourse projects; named ${mentioned.join(', ') || 'none'} of ${names.join(', ')}`,
      reply: args.reply,
    };
  }
  return null;
}

export function gradeShowSomethingElse(args: {
  buyer: string;
  reply: string;
  before: ThreadState;
  after: ThreadState;
}): QualityFail | null {
  if (!/\b(?:something else|other projects?|show me (?:more|others?))\b/i.test(args.buyer)) {
    return null;
  }
  const beforeFocus = focusedRef(args.before)?.projectId;
  const afterFocus = focusedRef(args.after)?.projectId;
  const recycled =
    beforeFocus &&
    afterFocus === beforeFocus &&
    /\bquarter acre\b/i.test(args.reply) &&
    args.after.phase === 'focused';
  if (recycled) {
    return {
      turn: args.buyer,
      reason: '"show me something else" stayed on the same focused overview — no pivot',
      reply: args.reply,
    };
  }
  // Prefer a real nearby widen over re-offering the same singleton as no_fit.
  const reofferedSameOnly =
    args.after.phase === 'discover' &&
    /\bclosest fit is \*Ayana\*/i.test(args.reply) &&
    !/\b(?:krishnaja|coorg|virajpet|nearby)\b/i.test(args.reply);
  if (reofferedSameOnly) {
    return {
      turn: args.buyer,
      reason: '"show me something else" re-offered Ayana without a nearby widen',
      reply: args.reply,
    };
  }
  return null;
}

/** RERA in the reply must match project detail — never invent a registration id. */
export function gradeReraGrounded(args: {
  buyer: string;
  reply: string;
  reraFromDetail: string | undefined | null;
}): QualityFail | null {
  if (!/\brera\b/i.test(args.buyer) && !/\brera\b/i.test(args.reply)) return null;
  const ids = args.reply.match(/PRM\/[A-Z]{2}\/RERA\/[\d/]+/gi) ?? [];
  if (ids.length === 0) {
    // Honest miss is fine when detail has no RERA.
    if (!args.reraFromDetail) return null;
    return {
      turn: args.buyer,
      reason: `detail has RERA ${args.reraFromDetail} but reply did not ground it`,
      reply: args.reply,
    };
  }
  if (!args.reraFromDetail) {
    return {
      turn: args.buyer,
      reason: `invented RERA id(s) ${ids.join(', ')} — project detail has no reraNumber`,
      reply: args.reply,
    };
  }
  for (const id of ids) {
    if (id.toUpperCase() !== args.reraFromDetail.toUpperCase()) {
      return {
        turn: args.buyer,
        reason: `RERA ${id} does not match detail ${args.reraFromDetail}`,
        reply: args.reply,
      };
    }
  }
  return null;
}
