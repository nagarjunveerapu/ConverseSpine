import type { ConversationState, Extracted, OfferedProject, TurnGoal, VisitState } from '../types.js';
import { extractDayWord, hasExplicitTime, parseVisitSlot, reparseVisitTime } from '../visit-slot.js';
import * as focused from './focused.js';

const DECLINE = /\b(no|nope|nah|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i;
const BARE_AFFIRM = /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|confirm(?:ed)?|go ahead|sounds good)\.?!?\s*$/i;
export const ALSO_RE = /\b(also|as well|too|bhi)\b/i;

/** Buyer adds another stop while visit scheduling is active. */
export function isVisitRouteExpand(text: string): boolean {
  return ALSO_RE.test(text.trim()) || /\b(?:add|include)\b/i.test(text.trim());
}
const INSTEAD_RE = /\binstead\b|\bki jagah\b/i;
const MAX_VISIT_STOPS = 4;

const VISIT_DEFERRABLE_TOPICS: import('../types.js').AnswerTopic[] = [
  'emi',
  'legal',
  'price',
  'media',
  'location',
  'property_type',
  'amenities',
  'availability',
];

export interface VisitCtx {
  text: string;
  now: Date;
}

/** Leave visit scheduling when the buyer asks something else (compare, more options, etc.). */
export function shouldExitVisitForIntent(ex: Extracted): boolean {
  if (ex.transition === 'want_visit') return false;
  if (ex.askTopic === 'compare') return true;
  if ((ex.compareProjectIds?.length ?? 0) >= 2) return true;
  if (ex.wantsMore) return true;
  if (ex.transition === 'see_others') return true;
  if (ex.rejected) return true;
  return false;
}

export function exitVisitPhase(s: ConversationState): ConversationState {
  const { visit: _v, ...rest } = s;
  return { ...rest, phase: s.focus ? 'focused' : 'discover' };
}

export function decide(s: ConversationState, ex: Extracted, ctx: VisitCtx): TurnGoal {
  const prior = s.visit ?? {};
  const now = ctx.now;

  if (ex.recall) return { kind: 'visit_recall' };

  const visitRouteExpand =
    ALSO_RE.test(ctx.text.trim()) && (ex.namedProjects?.length ?? 0) === 1 && !!prior.projectId;

  if (
    ex.askTopic &&
    VISIT_DEFERRABLE_TOPICS.includes(ex.askTopic) &&
    !parseVisitSlot(ctx.text, now) &&
    !visitRouteExpand
  ) {
    const focus =
      s.focus ??
      (s.discover.lastOffered[0]
        ? {
            projectId: s.discover.lastOffered[0].projectId,
            projectName: s.discover.lastOffered[0].name,
          }
        : null);
    if (focus) return focused.decide({ ...s, focus }, ex);
  }

  const slot = parseVisitSlot(ctx.text, now);
  const proposedFuture =
    !!prior.proposedIso && new Date(prior.proposedIso).getTime() > now.getTime();

  if (
    prior.awaitingConfirm &&
    prior.proposedIso &&
    hasExplicitTime(ctx.text) &&
    !slot
  ) {
    const reparsed = reparseVisitTime(prior.proposedIso, ctx.text);
    if (reparsed) {
      const projectName = prior.projectName ?? '';
      return {
        kind: 'visit_propose',
        iso: reparsed.proposedIso,
        label: reparsed.humanLabel,
        projectName,
        projectId: prior.projectId ?? '',
        copy: `Shall I block *${reparsed.humanLabel}* for your visit to *${projectName}*? Reply yes to confirm.`,
        state: {
          ...prior,
          awaitingConfirm: true,
          proposedIso: reparsed.proposedIso,
          proposedLabel: reparsed.humanLabel,
        },
      };
    }
  }

  if (prior.awaitingConfirm && ex.affirm && !ex.decline && !slot && proposedFuture) {
    return {
      kind: 'visit_booked',
      label: prior.proposedLabel ?? '',
      projectName: prior.projectName ?? '',
      projectId: prior.projectId ?? '',
      iso: prior.proposedIso ?? '',
    };
  }

  return step({
    text: ctx.text,
    named: ex.namedProjects ?? [],
    candidates: candidatesOf(s),
    prior,
    now,
    affirm: ex.affirm,
  });
}

function candidatesOf(s: ConversationState): OfferedProject[] {
  if (s.focus) return [{ projectId: s.focus.projectId, name: s.focus.projectName }];
  return [...s.discover.lastOffered];
}

function say(prefix: string, sentence: string): string {
  return prefix === ''
    ? sentence.charAt(0).toUpperCase() + sentence.slice(1)
    : prefix + sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function step(input: {
  text: string;
  named: OfferedProject[];
  candidates: OfferedProject[];
  prior: VisitState;
  now: Date;
  affirm?: boolean;
}): TurnGoal {
  const slot = parseVisitSlot(input.text, input.now);
  const declined = !slot && DECLINE.test(input.text);
  const askN = (input.prior.askCount ?? 0) + 1;
  let prefix = declined ? 'No problem — ' : '';

  let projectId = input.prior.projectId;
  let projectName = input.prior.projectName;
  let queued = input.prior.queued ?? [];

  if (input.named.length > 1) {
    const capped = input.named.slice(0, MAX_VISIT_STOPS);
    const overflow = input.named.length - capped.length;
    const [first, ...rest] = capped;
    projectId = first!.projectId;
    projectName = first!.name;
    queued = rest.map((p) => ({ projectId: p.projectId, projectName: p.name }));
    if (overflow > 0) {
      prefix = `${prefix}We'll start with ${capped.length} stops and set up the other ${overflow} after — `;
    }
  }

  const singleNamed = input.named.length === 1 ? input.named[0]! : null;
  if (singleNamed && projectId && singleNamed.projectId !== projectId) {
    if (ALSO_RE.test(input.text) && !INSTEAD_RE.test(input.text)) {
      if (!queued.some((q) => q.projectId === singleNamed.projectId)) {
        queued = [
          ...queued,
          { projectId: singleNamed.projectId, projectName: singleNamed.name },
        ];
      }
      prefix = `We'll plan *${singleNamed.name}* as well — `;
    } else {
      const old = { projectId, projectName, queued, slotText: input.prior.slotText };
      const parkOld = !INSTEAD_RE.test(input.text) && !!old.projectId && !!old.slotText;
      const parked = [
        ...(parkOld
          ? [
              {
                projectId: old.projectId!,
                projectName: old.projectName ?? '',
                slotText: old.slotText!,
              },
            ]
          : []),
        ...(old.queued ?? []),
      ];
      projectId = singleNamed.projectId;
      projectName = singleNamed.name;
      queued = parked;
    }
  } else if (singleNamed && !projectId) {
    projectId = singleNamed.projectId;
    projectName = singleNamed.name;
  } else if (!projectId && input.candidates.length === 1) {
    projectId = input.candidates[0]!.projectId;
    projectName = input.candidates[0]!.name;
  }

  if (!projectId || !projectName) {
    const copy = declined
      ? 'No problem — which project would you like to visit?'
      : 'Which project should I set up the visit for?';
    return {
      kind: 'visit_ask',
      ask: 'project',
      copy,
      state: { ...input.prior, askCount: askN, lastAsk: 'project' },
    };
  }

  const stopPreview =
    queued.length > 0
      ? ` — then *${queued.map((q) => q.projectName).join('*, *')}*`
      : '';

  if (!slot && !input.prior.slotText) {
    if (BARE_AFFIRM.test(input.text.trim())) {
      return {
        kind: 'visit_ask',
        ask: 'day',
        copy: say(
          prefix,
          `which day works for *${projectName}*${stopPreview}? — for example Saturday or tomorrow.`,
        ),
        state: {
          projectId,
          projectName,
          queued,
          askCount: askN,
          lastAsk: 'day',
        },
      };
    }
    const copy = declined
      ? `No problem — which day works for *${projectName}*${stopPreview}?`
      : say(
          prefix,
          `which day works for your visit to *${projectName}*${stopPreview}? (e.g. Saturday, tomorrow)`,
        );
    return {
      kind: 'visit_ask',
      ask: 'day',
      copy,
      state: { projectId, projectName, queued, askCount: askN, lastAsk: 'day' },
    };
  }

  const parsed = slot ?? (input.prior.slotText ? parseVisitSlot(input.prior.slotText, input.now) : null);
  if (!parsed) {
    return {
      kind: 'visit_ask',
      ask: 'day',
      copy: `I didn't catch the day — when would you like to visit *${projectName}*? (e.g. Saturday, tomorrow)`,
      state: { projectId, projectName, queued, lastAsk: 'day' },
    };
  }

  const dayWord = extractDayWord(parsed.humanLabel) ?? extractDayWord(input.text);
  const queuedNote =
    queued.length > 0
      ? ` After this we'll plan *${queued[0]!.projectName}*${queued.length > 1 ? ` and ${queued.length - 1} more` : ''}.`
      : '';

  const copy = say(
    prefix,
    `shall I block *${parsed.humanLabel}* for your visit to *${projectName}*?${queuedNote} Reply yes to confirm.`,
  );

  return {
    kind: 'visit_propose',
    iso: parsed.proposedIso,
    label: parsed.humanLabel,
    projectName,
    projectId,
    copy,
    state: {
      projectId,
      projectName,
      queued,
      awaitingConfirm: true,
      proposedIso: parsed.proposedIso,
      proposedLabel: parsed.humanLabel,
      slotText: input.text,
      lastAsk: 'time',
    },
  };
}

export function recallReply(): string {
  return "I'll pull your visit schedule from our system — our team can confirm the exact slots on WhatsApp.";
}
