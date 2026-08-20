/**
 * What the bot says after an erasure — built from what happened, not from a
 * string literal.
 *
 * Both stop branches used to end in a hardcoded sentence:
 *
 *   "I've removed your details from our system. You won't hear from us again."
 *
 * It was true of no run that ever happened. `deleteBuyerMemory` cleared one
 * table out of the thirty-odd holding the buyer; the delete-confirm branch
 * cancelled no visits at all, so the very next message could read the buyer
 * their own visit slot back; and Desk's memory mirror wrote the row back at
 * the end of the next turn — 10 of 11 times, measured on dev.
 *
 * The sentence also can't be fixed by rewording it, because the truth varies
 * per run: a buyer with a signed booking keeps a record, a partial run needs a
 * human to finish, and "stop calling me" is not "forget me". So the reply is
 * assembled from the receipt Desk returns, and every clause below traces to a
 * field on it. When there is no receipt, we say we started and a person will
 * confirm — which is the honest description of not knowing.
 */

import type { ErasureReceipt } from './ports';

export interface ErasureReplyOpts {
  /**
   * The retained record in the buyer's own words ("your booking at Brigade
   * Eldorado"). Only used when the receipt COUNTS a surviving booking — the
   * manifest retains that table as policy for every buyer alive, so reading
   * the policy instead of the count would name a booking that doesn't exist.
   */
  retainedLabel?: string;
}

/** Rows actually touched. Zero is meaningful: nothing was found to erase. */
export function rowsTouched(r: ErasureReceipt): number {
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return sum(r.deleted ?? {}) + sum(r.redacted ?? {});
}

/** True when the run finished and we can say so. */
export function isComplete(r: ErasureReceipt | null): boolean {
  return Boolean(r && r.tombstone_written && (r.failed?.length ?? 0) === 0);
}

/**
 * The line for a completed erasure, a partial one, or a stop-only request.
 *
 * `visitsCancelled` comes from Spine's own call, not the receipt — the visit
 * machine lives here. It is named out loud because a buyer who booked a
 * Saturday visit needs to know it is off; the old reply said nothing, and on
 * the delete-confirm branch it wasn't even true.
 */
export function composeErasureReply(
  receipt: ErasureReceipt | null,
  opts: ErasureReplyOpts & { scope: 'all' | 'contact_only'; visitsCancelled?: number } ,
): string {
  const visits = opts.visitsCancelled ?? 0;
  const visitClause =
    visits === 1 ? ' Your site visit is cancelled.'
    : visits > 1 ? ` Your ${visits} site visits are cancelled.`
    : '';

  if (opts.scope === 'contact_only') {
    return "Understood — I've stopped all messages and cancelled anything standing." +
      visitClause.replace(' Your', ' Your') +
      " I haven't deleted your details, so nothing is lost if you come back." +
      // The advertised word, not a phrase to guess at. This sentence used to
      // read 'Say "delete my data"' — which is the exact vocabulary problem
      // the consent notice exists to end.
      ' Reply DELETE if that\'s what you\'d like instead.';
  }

  // No receipt, no tombstone, or a table that threw — all the same thing to
  // the buyer: we cannot show it finished. Desk leaves the DPDP row
  // 'in_progress' in exactly these cases, so a person picks it up.
  if (!isComplete(receipt)) {
    return "I've started removing your details and stopped all messages." +
      visitClause +
      ' Part of it needs a person to finish, so our team will complete it and' +
      " confirm — you won't hear from us in the meantime.";
  }

  const r = receipt!;
  const base =
    "Done — your chat history, your saved brief and everything we'd learned" +
    ' about your search are deleted, and we won\'t message you again.' +
    visitClause;

  // Counts, not policy. See ErasureReplyOpts.retainedLabel.
  const keptBookings = r.retained_counts?.['bookings'] ?? 0;
  if (keptBookings <= 0) return base;

  const label = opts.retainedLabel || (keptBookings > 1 ? 'your bookings' : 'your booking');
  return `${base} One thing stays: ${label} — that's a signed agreement we're` +
    ' required to keep. Ask the site team about it any time.';
}

/**
 * The one-line trace for `debug.tools`, so a replay can tell a real sweep from
 * a no-op. `tools: ['deleteBuyerMemory']` used to be the whole record, and it
 * said the same thing whether thirty tables cleared or the call had failed.
 */
export function erasureTrace(r: ErasureReceipt | null, visitsCancelled: number): string[] {
  if (!r) return ['eraseBuyer:no_receipt', `cancelSiteVisits:${visitsCancelled}`];
  const tables = Object.keys(r.deleted ?? {}).length + Object.keys(r.redacted ?? {}).length;
  const out = [
    `eraseBuyer:${r.scope}`,
    `tables:${tables}`,
    `rows:${rowsTouched(r)}`,
    `cancelSiteVisits:${visitsCancelled}`,
  ];
  if (r.unteach_phrasing_ids?.length) out.push(`unteach:${r.unteach_phrasing_ids.length}`);
  if (!r.tombstone_written) out.push('NO_TOMBSTONE');
  if (r.failed?.length) out.push(`failed:${r.failed.join(',')}`);
  return out;
}

/** What the doors need to run an erasure. Spine's ids, not Desk's. */
export interface ErasureRunInput {
  /** Spine's conversation id — the key for L0 state in the DO and in KV. */
  convId: string;
  builderId: string;
  /** Desk's conversation id. Without one there is nothing in Desk to erase. */
  ndConversationId: string;
  /** Needed for the second DO address, which is keyed `builderId:phone`. */
  buyerPhone: string;
  scope: 'all' | 'contact_only';
  retainedLabel?: string;
}

export interface ErasureRunResult {
  receipt: ErasureReceipt | null;
  visitsCancelled: number;
  reply: string;
  tools: string[];
  /** True once L0 state is gone — the caller must not `save()` after this. */
  purged: boolean;
}

/**
 * Run an erasure across everything Spine can reach, and say what happened.
 *
 * Both stop doors used to do their own thing. The standalone-STOP door cleared
 * buyer memory and cancelled visits; the delete-confirm door — the one the
 * buyer reaches by TYPING "delete my data" and then confirming, which is the
 * more deliberate request of the two — cleared buyer memory and nothing else.
 * They then printed the same sentence. Same promise, two different amounts of
 * work behind it.
 *
 * Order is deliberate:
 *
 *  1. **Desk first.** The tombstone it writes is what keeps the erasure erased;
 *     until it exists, every later step can be undone by the next ordinary
 *     write. It also returns the receipt everything else here is composed from.
 *  2. **Visits next.** The visit machine lives in Spine, so Desk cannot cancel
 *     them. We cancel even when the Desk sweep came back partial: an unwanted
 *     site visit is never the safer failure.
 *  3. **Local state last.** Purging kills the state object that holds
 *     `ndConversationId`, so it cannot run before the two steps that need it.
 *
 * Nothing here throws. A buyer who asked to be forgotten gets an answer either
 * way; when we cannot show the run finished, the reply says a person will
 * finish it and Desk's DPDP row stays `in_progress` so one actually does.
 */
export async function performErasure(
  deps: Pick<import('./ports').EngineDeps, 'crm' | 'data' | 'store'>,
  input: ErasureRunInput,
): Promise<ErasureRunResult> {
  const receipt = await deps.crm
    .eraseBuyer(input.ndConversationId, input.scope)
    .catch(() => null);

  const visitsCancelled = await deps.data
    .cancelSiteVisits(input.ndConversationId)
    .catch(() => 0);

  // `freshSession()` was what stood here, and it is not a delete: it builds a
  // blank state and `save()` writes it over the old one, leaving the KV copy to
  // live out its 30 days. The DO is addressed two ways — `state:{convId}` for
  // L0, `{builderId}:{phone}` for the WhatsApp debouncer, which holds the
  // buyer's phone number and their raw un-processed messages — so both go.
  // Only a real erasure purges. `contact_only` means "stop messaging me" —
  // the record is retained by design at Desk, and throwing away the thread
  // here would lose the buyer's context for a request that never asked for it.
  // They can still write to us; silence is the tombstone's job, not amnesia's.
  let purged = false;
  if (deps.store.purge && input.scope === 'all') {
    await deps.store
      .purge(input.convId, { builderId: input.builderId, buyerPhone: input.buyerPhone })
      .then(() => { purged = true; })
      .catch(() => {});
  }

  const opts: ErasureReplyOpts & { scope: 'all' | 'contact_only'; visitsCancelled: number } = {
    scope: input.scope,
    visitsCancelled,
    ...(input.retainedLabel ? { retainedLabel: input.retainedLabel } : {}),
  };

  const tools = erasureTrace(receipt, visitsCancelled);
  if (!purged) tools.push('NO_PURGE');

  return {
    receipt,
    visitsCancelled,
    reply: composeErasureReply(receipt, opts),
    tools,
    purged,
  };
}
