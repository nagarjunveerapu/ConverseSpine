/**
 * WHO OWNS AN INTENT — one authority per kind, never a race.
 *
 * The measured problem: the embedding recognises `opt_out`, `escalate_to_human`,
 * `report_issue` and friends confidently, and NOTHING consumes the verdict.
 * `INTENT_TO_TOPIC` has no row for them, so `mapIntentToRouting` returns null,
 * and the turn falls through to the search path — a buyer typing "stop all
 * messages yaar" gets a list of projects in Sakleshpur.
 *
 * The obvious fix — hand `routing` to `decide()` and let it arbitrate against
 * the extraction — would put two authorities on the same decision, which is
 * exactly the design we do not want. So instead:
 *
 *   Extraction owns VALUES.  What the buyer named: budget, bhk, area, project,
 *                            visit slot. Unchanged, untouched.
 *   The embedding owns MEANING — but ONLY where extraction has no slot at all.
 *
 * The seam that makes "only where nothing else owns it" mechanical rather than
 * a judgement call: `miss_reason === 'unmapped_kind'`. Read `embedderRouting` —
 * that value is returned only AFTER the score cleared tau and ONLY when
 * `mapIntentToRouting` declined the kind. It therefore means precisely:
 *
 *     the embedding is confident, and no existing owner wants this.
 *
 * There is nothing to conflict with, by construction. If a kind ever gains a
 * topic mapping, `unmapped_kind` stops firing for it and this module goes
 * silent for that kind automatically — ownership can never be held twice.
 */
import { answerRequirements } from '../answer-contract.js';
import { resolveFaqQuestionKeys } from '../faq-keys.js';
import type { Extracted } from '../types.js';
import type { TurnRoutingResult } from './types.js';

/**
 * Effects an intent may assert on the turn. Deliberately tiny: each maps to a
 * path the engine ALREADY has, so this slice adds no new answer content and no
 * new copy — it only stops the engine guessing when it already knew the answer.
 */
export interface IntentEffect {
  /** Opt-out. Feeds the existing ex.stop path, which confirms before deleting. */
  stop?: true;
  /** Wants a person: escalation, a callback, or a complaint to log. */
  wantsHuman?: true;
}

/**
 * The single ownership table. A kind appears at most once, and only kinds with
 * NO other owner appear at all.
 *
 * Deliberately absent, and why:
 *  - get_price/get_legal_info/get_brochure/get_availability/find_projects/… —
 *    extraction already resolves these (3/3 each on held-out language). Adding
 *    them here would create the second authority this design exists to avoid.
 *  - ask_delivery_timeline/ask_investment_return/get_payment_plan — the engine
 *    has no evidence to answer them with (~1,541 corpus rows behind a real Desk
 *    data gap). Claiming them here would trade a wrong answer for a different
 *    wrong answer. They stay unowned so they reach the clarify floor honestly.
 */
export const INTENT_EFFECTS: Readonly<Record<string, IntentEffect>> = Object.freeze({
  opt_out: { stop: true },
  escalate_to_human: { wantsHuman: true },
  escalate: { wantsHuman: true },
  report_issue: { wantsHuman: true },
  callback: { wantsHuman: true },
  request_callback: { wantsHuman: true },
});

/** True when the embedding was confident AND no existing owner claimed the kind. */
export function isUnclaimedIntent(routing: TurnRoutingResult | undefined): boolean {
  return routing?.bind?.miss_reason === 'unmapped_kind' && !!routing.bind.top_kind;
}

/**
 * Catalog facet / FAQ / media / FactKey already owns this turn.
 * Used so soft escalate/callback binds cannot steal "can I get the PDF/loan?".
 * True "talk to a human" still arrives via speech-act chips, not this path.
 */
export function catalogAskOwns(ex: Extracted, text = ''): boolean {
  if (ex.askTopic || (ex.askTopics?.length ?? 0) > 0) return true;
  if (ex.mediaAssetKind) return true;
  const t = text.trim();
  if (!t) return false;
  if (resolveFaqQuestionKeys(t).length > 0) return true;
  if (answerRequirements(t).length > 0) return true;
  return false;
}

/**
 * Let the intent verdict fill the meaning slots nothing else owns.
 *
 * Returns `ex` unchanged unless every condition holds, so the default path is
 * byte-identical to before:
 *   - the embedding cleared tau and its kind was unmapped (`isUnclaimedIntent`);
 *   - that kind has a declared effect;
 *   - the slot the effect writes is still empty (extraction never loses a slot
 *     it filled — belt and braces on top of the unmapped-kind seam).
 */
export function applyIntentAuthority(
  ex: Extracted,
  routing: TurnRoutingResult | undefined,
  text = '',
): { ex: Extracted; wrote: Array<'stop' | 'wantsHuman'>; kind?: string } {
  if (!isUnclaimedIntent(routing)) return { ex, wrote: [] };
  const kind = routing!.bind!.top_kind!;
  const effect = INTENT_EFFECTS[kind];
  if (!effect) return { ex, wrote: [] };

  let next = ex;
  const wrote: Array<'stop' | 'wantsHuman'> = [];
  if (effect.stop && !next.stop) {
    next = { ...next, stop: true };
    wrote.push('stop');
  }
  if (effect.wantsHuman && !next.wantsHuman) {
    // Facet/FAQ/media already owns — "can I get the PDF" must not become
    // request_callback → handoff. Explicit human asks still set wantsHuman
    // via speech-act chip resolve, not this unmapped-kind path.
    if (catalogAskOwns(next, text)) {
      return { ex: next, wrote, kind };
    }
    next = { ...next, wantsHuman: true };
    wrote.push('wantsHuman');
  }
  return { ex: next, wrote, kind };
}

/**
 * Embedder abstention is the authority for the unknown recovery. Structured
 * extraction suppresses it when another owner already understood the turn.
 *
 * `text` (optional): FactKey patterns in `answerRequirements` own focused
 * asks that never become `askTopic` (appreciation, yield, carpet…). Without
 * this, embedder below_tau → "rephrase" while the answer contract already
 * knew the ask ("has this area appreciated" cliff on dig Advisor).
 */
export function shouldSurfaceUnknownIntent(
  ex: Extracted,
  routing: TurnRoutingResult | undefined,
  authorityClaimed: boolean,
  text = '',
): boolean {
  if (authorityClaimed || routing?.routing !== 'defer') return false;
  const miss = routing.bind?.miss_reason;
  if (
    !routing.bind?.embed_fired ||
    (miss !== 'below_tau' && miss !== 'no_match' && miss !== 'unmapped_kind')
  ) {
    return false;
  }
  if (ex.speechAct && ex.speechAct !== 'unknown') return false;
  if (
    ex.smalltalk ||
    ex.affirm ||
    ex.decline ||
    ex.recall ||
    ex.wantsMore ||
    ex.firstHomeHelp ||
    ex.askTopic ||
    ex.askTopics?.length ||
    ex.namedProjects?.length ||
    ex.pickName ||
    (ex.transition && ex.transition !== 'none') ||
    Object.keys(ex.constraints).length
  ) {
    return false;
  }
  // Closed FactKey extractors — same set that withAnswerRequirements uses.
  if (text.trim() && answerRequirements(text).length > 0) return false;
  // FAQ-shaped chips (builder honesty, bare loan/when…) — same closed set as
  // focused evidence fetch. Without this, embedder below_tau → "rephrase"
  // even when resolveFaqQuestionKeys already owned the turn.
  if (text.trim() && resolveFaqQuestionKeys(text).length > 0) return false;
  return true;
}
