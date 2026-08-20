/**
 * What Desk already knows, made readable by the bot.
 *
 * THE OMISSION THIS FIXES
 *
 * `bootstrapContext` fetches the whole Desk conversation row on every cold
 * turn. The engine WRITES four of that row's fields back to Desk —
 * `bhk_preference` and `budget_inr` (turn.ts), `location_pref`, and
 * `shortlist_project_ids` (adapters/nayadesk.ts) — and has never read one of
 * them. Every wire runs one way.
 *
 * So a buyer who filled Desk's registration form at the site office and then
 * opened WhatsApp met a bot that knew nothing about them, and "what's my
 * budget" answered *"I don't have your brief on file yet"* while the brief sat
 * in a row the same turn had already fetched. The data was there. The reading
 * was not.
 *
 * TWO RULES, AND THEY ARE THE WHOLE MODULE
 *
 * 1. **Gap-fill only.** The live session always wins. A buyer who said "make
 *    it 2 BHK" this turn must not be overruled by a form they filled last
 *    week — Desk's row is the older statement by construction, since the
 *    engine is what writes to it. This is the same rule
 *    `hydrateStateFromFeedForward` follows for the ledger prior.
 *
 * 2. **Never widen a value on the way in.** `budget_inr` is free text a person
 *    or a form put in a column; `purpose` is a column that can hold anything.
 *    A value that does not parse is DROPPED, not guessed at, because a budget
 *    the bot invented and then read back as "your budget" is worse than a bot
 *    that admits it has no brief.
 */
import { parseBudgetToInr } from './facts.js';
import type { DeskBrief } from './ports.js';
import type { ConversationState, Constraints } from './types.js';

/** Desk's `purpose` column is free-form; only these two mean anything here. */
function readPurpose(raw: string | undefined): Constraints['purpose'] | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'self_use' || v === 'investment') return v;
  return undefined;
}

/**
 * Fold Desk's record into a cold session.
 *
 * Returns the state unchanged when there is nothing to add, so a conversation
 * with a live brief takes a byte-identical path to before.
 */
export function seedFromDeskBrief(
  state: ConversationState,
  brief: DeskBrief | undefined,
): { state: ConversationState; seeded: string[] } {
  if (!brief) return { state, seeded: [] };

  const seeded: string[] = [];
  const c: Constraints = { ...state.constraints };

  if (!c.bhk?.trim() && brief.bhk) {
    c.bhk = brief.bhk;
    seeded.push('bhk');
  }
  if (!c.location?.trim() && brief.location) {
    c.location = brief.location;
    seeded.push('location');
  }
  if (c.purpose === undefined) {
    const purpose = readPurpose(brief.purpose);
    if (purpose) {
      c.purpose = purpose;
      seeded.push('purpose');
    }
  }
  if (c.budgetMaxInr === undefined && brief.budget) {
    // The column holds whatever was typed — "80 lakh", "₹1.2 Cr", "call me".
    // One parser decides, and it is the same one that reads a buyer's message,
    // so a number can never come to mean two things.
    const parsed = parseBudgetToInr(brief.budget);
    if (parsed?.max) {
      c.budgetMaxInr = parsed.max;
      if (parsed.min !== undefined && c.budgetMinInr === undefined) c.budgetMinInr = parsed.min;
      seeded.push('budget');
    }
  }

  let next = state;
  if (seeded.length) next = { ...next, constraints: c };

  if (!next.buyerName?.trim() && brief.buyerName) {
    next = { ...next, buyerName: brief.buyerName };
    seeded.push('buyerName');
  }

  // Desk's board, kept only when this session has none of its own. Ids, not
  // names: the names come from the catalog the turn already holds, so reading
  // the board back costs no call. Spine has been WRITING this list to Desk
  // since the shortlist existed and had never once read it.
  if (
    brief.shortlistProjectIds.length &&
    (next.shortlistIds?.length ?? 0) === 0 &&
    (next.discover.lastOffered?.length ?? 0) === 0
  ) {
    next = { ...next, deskShortlistIds: brief.shortlistProjectIds };
    seeded.push('shortlist');
  }

  if (brief.selfRegistered && !next.selfRegistered) {
    next = { ...next, selfRegistered: true };
    seeded.push('selfRegistered');
  }

  return { state: next, seeded };
}

/**
 * The shortlist to speak, and where it came from.
 *
 * Live session board first — it has names and it is what the buyer was
 * actually shown. Desk's durable ids are the fallback, resolved against the
 * catalog name index the turn already fetched. An id the catalog cannot name
 * is dropped rather than spoken as an id: "your shortlist: proj_8f21c" is not
 * an answer to anybody.
 */
export function resolveShortlistNames(
  state: ConversationState,
  live: ReadonlyArray<{ name: string }>,
  catalogNames: ReadonlyArray<{ projectId: string; name: string }> | undefined,
): string[] {
  const fromLive = live.map((p) => p.name.trim()).filter(Boolean);
  if (fromLive.length) return fromLive;

  const ids = state.deskShortlistIds ?? [];
  if (!ids.length || !catalogNames?.length) return [];
  const byId = new Map(catalogNames.map((p) => [p.projectId, p.name]));
  return ids.map((id) => byId.get(id)?.trim() ?? '').filter(Boolean);
}
