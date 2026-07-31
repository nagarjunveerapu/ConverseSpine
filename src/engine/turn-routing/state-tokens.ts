/**
 * Phase 2 — discourse state tokens for the intent embed query.
 *
 * LLD §5: the routing function is (state, text) → intent, but the embedding
 * query was text-only. These tokens are the missing input dimension. They
 * must be applied to corpus rows in lockstep (SIL_STATE_TOKENS + rebuild).
 *
 * One primary token per turn (mutually exclusive, most-specific wins):
 *   <visit_pending> > <focused> > <board:N> > <cold>
 */
import type { ConversationState } from '../types.js';
import { currentShortlist } from '../entity-store.js';
import type { TurnRoutingInput } from './types.js';

export type DiscourseStateToken =
  | '<cold>'
  | '<focused>'
  | '<visit_pending>'
  | `<board:${number}>`;

export function boardCountFromState(state: ConversationState): number {
  return currentShortlist(state).length;
}

export function discourseStateToken(input: {
  phase: string;
  focus?: { project_id?: string; project_name?: string } | null;
  visit?: {
    awaiting_confirm?: boolean;
    booked_count?: number;
    project_id?: string;
  } | null;
  boardCount: number;
}): DiscourseStateToken {
  if (input.phase === 'visit' || input.visit?.awaiting_confirm) {
    return '<visit_pending>';
  }
  if (input.focus?.project_id) return '<focused>';
  const n = Math.max(0, Math.floor(input.boardCount));
  if (n >= 1) return `<board:${Math.min(n, 9)}>`;
  return '<cold>';
}

export function discourseStateTokenFromRouting(input: TurnRoutingInput): DiscourseStateToken {
  return discourseStateToken({
    phase: input.phase,
    focus: input.focus,
    visit: input.visit,
    boardCount: input.board_count ?? 0,
  });
}

/** Prefix buyer text for embed — corpus rows must use the same prefix. */
export function withDiscourseStatePrefix(text: string, token: DiscourseStateToken): string {
  const body = text.trim();
  if (!body) return token;
  return `${token} ${body}`;
}

/**
 * Intents whose meaning depends on discourse state. Rebuild expands each
 * eligible row into one vector per token when SIL_STATE_TOKENS is on.
 * Fact intents (`get_price`, …) stay unprefixed.
 */
export const STATE_DEPENDENT_INTENT_KINDS: ReadonlySet<string> = new Set([
  'ask_next_step',
  'confirm_action',
]);

/** Closed expand set — board uses N=2 as the shortlist exemplar (not every N). */
export const STATE_TOKEN_EXPAND_SET: readonly DiscourseStateToken[] = [
  '<cold>',
  '<board:2>',
  '<focused>',
  '<visit_pending>',
];

export function discourseStateIdSuffix(token: DiscourseStateToken): string {
  return token.replace(/^<|>$/g, '').replace(/:/g, '_');
}

/** Expand one registry row into prefixed siblings (empty when not state-dependent). */
export function expandRowForStateTokens<
  T extends { id: string; phrasing: string; intent_kind: string; is_negative?: boolean },
>(row: T): Array<T & { discourse_state: DiscourseStateToken }> {
  if (row.is_negative || !STATE_DEPENDENT_INTENT_KINDS.has(row.intent_kind)) {
    return [];
  }
  return STATE_TOKEN_EXPAND_SET.map((discourse_state) => ({
    ...row,
    id: `${row.id}:st:${discourseStateIdSuffix(discourse_state)}`,
    discourse_state,
  }));
}
