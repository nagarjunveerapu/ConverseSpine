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
import { isAskNextStepText } from '../ask-next-step-detect.js';
import { resolveFaqQuestionKeys } from '../faq-keys.js';
import { DECLINE } from '../turn-intent/dialogue-acts.js';
import type { Extracted } from '../types.js';
import type { TurnRoutingResult } from './types.js';
import { isAttentionNudge } from '../placeability.js';

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
  /**
   * Asking about their OWN record — "what do you know about me", "what's on
   * my shortlist", "which area did I say". Feeds the existing
   * `ex.recallConstraints` path, which reads the brief back and shows the
   * board. No new answer content: the read-back template already existed.
   */
  recallConstraints?: true;
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
  /**
   * "What do you know about me / what's my budget / what's on my shortlist."
   *
   * Extraction owns a NARROW slice of this already — `CONSTRAINT_RECALL_RE`
   * matches "what was my budget", "which area did i pick" and about six other
   * exact shapes. It does not match a buyer asking the general question, and
   * across 22,703 corpus rows there was not one self-referential phrasing, so
   * "what do you know about me" landed on the clarify floor.
   *
   * The fix is corpus, not another regex arm (P7). `recall_profile` is a new
   * kind with no `INTENT_TO_TOPIC` row, so it arrives here as `unmapped_kind`
   * — the seam that makes "nobody else owns this" mechanical. The moment the
   * regex DOES match, extraction has already set the flag and the guard below
   * makes this a no-op, so the two can never both decide.
   *
   * Note `about_data` deliberately stays unowned: "what personal data do you
   * collect" is a privacy-policy question, and answering it with this buyer's
   * budget would be a different wrong answer.
   */
  recall_profile: { recallConstraints: true },
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
/** Closed size token — configs digression with no askTopic stamp ("2BHK"). */
export const BARE_BHK_CONFIG_RE = /^\s*\d+(?:\.\d+)?\s*bhk\s*[.!?]?\s*$/i;

export function catalogAskOwns(ex: Extracted, text = ''): boolean {
  if (ex.askTopic || (ex.askTopics?.length ?? 0) > 0) return true;
  if (ex.mediaAssetKind) return true;
  const t = text.trim();
  if (!t) return false;
  if (BARE_BHK_CONFIG_RE.test(t)) return true;
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
): { ex: Extracted; wrote: Array<'stop' | 'wantsHuman' | 'recallConstraints'>; kind?: string } {
  if (!isUnclaimedIntent(routing)) return { ex, wrote: [] };
  const kind = routing!.bind!.top_kind!;
  const effect = INTENT_EFFECTS[kind];
  if (!effect) return { ex, wrote: [] };

  let next = ex;
  const wrote: Array<'stop' | 'wantsHuman' | 'recallConstraints'> = [];
  if (effect.stop && !next.stop) {
    // Soft CTA decline ("no thanks", "nahi chahiye") nearest-neighbors opt_out.
    // That must NOT open the delete/contact-scope confirm — stay focused.
    // Hard contact/data opt-out still reaches ex.stop via STOP_RE / chip.stop;
    // this path only fills when the embedder alone owned the meaning.
    const softDecline = !!next.decline || DECLINE.test(text.trim());
    if (!softDecline) {
      next = { ...next, stop: true };
      wrote.push('stop');
    }
  }
  if (effect.recallConstraints && !next.recallConstraints) {
    // A catalog/FAQ ask already owns the turn — "what's the price of my
    // shortlist" is a price question that happens to say "my". Never let a
    // profile read-back displace an answer the engine can actually give.
    if (catalogAskOwns(next, text)) {
      return { ex: next, wrote, kind };
    }
    // `recall` is the VISIT recall path ("when is my visit"), which owns its
    // own answer. Extraction sets them mutually exclusive; keep it true here.
    if (!next.recall) {
      next = { ...next, recallConstraints: true };
      wrote.push('recallConstraints');
    }
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
  // A knock is not an unknown request. "hello?" / "anyone there?" fell to
  // unknown_request → "I couldn't make sense of that" — twice running, since a
  // second knock reads the same. Let it route: project-first WA re-offers the
  // book, which is what a waiting buyer wanted.
  if (isAttentionNudge(text)) return false;
  // Closed FactKey extractors — same set that withAnswerRequirements uses.
  if (text.trim() && answerRequirements(text).length > 0) return false;
  // FAQ-shaped chips (builder honesty, bare loan/when…) — same closed set as
  // focused evidence fetch. Without this, embedder below_tau → "rephrase"
  // even when resolveFaqQuestionKeys already owned the turn.
  if (text.trim() && resolveFaqQuestionKeys(text).length > 0) return false;
  // Phase 2 — ask_next_step has a state-conditioned consumer; below_tau must
  // not become unknown_request "rephrase" before decideGoalAsync runs.
  if (text.trim() && isAskNextStepText(text)) return false;
  return true;
}
