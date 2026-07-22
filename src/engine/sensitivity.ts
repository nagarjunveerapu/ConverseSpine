/**
 * Four-questions rendering helpers — pure functions over rank receipts.
 *
 * The Desk emits DATA (dimension_fit / dimension_gap per match); compose
 * emits WORDS. These helpers are the only place receipts become clauses,
 * so the two never drift:
 *   - matchFitClauses: the per-project why/trade-off line (Q1 + Q2),
 *     fits-first with the Desk-authored tradeoff_note as fallback only.
 *   - sensitivityLine: the shortlist-level "what would change this order"
 *     (Q3) — computed from the same receipts, never authored copy.
 *
 * Nothing here is domain data: DIMENSION_NOUN names ENGINE dimensions
 * (structure), exactly like the Desk's UNKNOWN_LABEL map. A dimension this
 * map doesn't know renders as its raw key — new dimensions degrade
 * honestly instead of being invented or dropped.
 */

import type { Match, DimensionFitReceipt } from './types.js';

/** Buyer-facing noun for an engine ranking dimension. */
const DIMENSION_NOUN: Record<string, string> = {
  commute: 'the drive',
  schools: 'schools',
  budget: 'price',
  walkability: 'daily-needs access',
  builder_trust: 'the builder record',
  value: 'the value trend',
};

const noun = (dim: string): string => DIMENSION_NOUN[dim] ?? dim.replace(/_/g, ' ');

/** Max clauses on one match line — kept scannable on every channel. */
const MAX_FIT_CLAUSES = 3;

/**
 * Q1 + Q2 for one match: top gain (✓), top cost (⚠), absence (?), ranked by
 * the buyer's own weights. Falls back to the Desk note only when no typed
 * receipts arrived (older Desk, cache) — the note never ADDS to receipts,
 * that would be two voices.
 */
export function matchFitClauses(m: Match): string {
  const fits = m.dimensionFit ?? [];
  if (fits.length === 0 && !m.dimensionGap) return m.tradeoffNote ?? '';

  const byPriority = (a: DimensionFitReceipt, b: DimensionFitReceipt): number =>
    b.weight - a.weight || b.score - a.score;
  const goods = fits.filter((f) => f.good).sort(byPriority);
  const bads = fits.filter((f) => !f.good).sort((a, b) => b.weight - a.weight || a.score - b.score);

  const parts: string[] = [];
  if (goods[0]) parts.push(`✓ ${goods[0].evidence}`);
  if (bads[0]) parts.push(`⚠ ${bads[0].evidence}`);
  if (m.dimensionGap) parts.push(`? ${m.dimensionGap.label}`);
  // Room left and nothing negative to say → a second earned gain may speak.
  if (parts.length < MAX_FIT_CLAUSES && goods[1] && !bads[0] && !m.dimensionGap) {
    parts.push(`✓ ${goods[1].evidence}`);
  }
  return parts.slice(0, MAX_FIT_CLAUSES).join(' · ');
}

/** A dimension only anchors the sensitivity line when the buyer weighted it
 *  at least this much — mirrors the Desk's GAP_WEIGHT_FLOOR. */
const SENSITIVITY_WEIGHT_FLOOR = 0.5;

/**
 * Q3 — the honest "what would change this order", computed from the
 * shortlist's receipts:
 *   - Buyer's bar = highest-weighted dimension seen across fits + gaps.
 *   - Nobody has data on the bar → say so plainly (the records team is on
 *     it via the Desk's content-gap emission) and name today's leader on
 *     what IS on file.
 *   - Somebody leads on the bar → name them; if a second-weighted dimension
 *     crowns a DIFFERENT project, name that fork — that's the real choice.
 * Empty string when there's nothing honest to say (one match, no weights).
 */
export function sensitivityLine(matches: readonly Match[]): string {
  if (matches.length < 2) return '';

  // Aggregate the buyer's weighted dimensions across the shortlist.
  const dims = new Map<string, { weight: number; holders: Array<{ name: string; score: number }> }>();
  for (const m of matches) {
    for (const f of m.dimensionFit ?? []) {
      const d = dims.get(f.dimension) ?? { weight: 0, holders: [] };
      d.weight = Math.max(d.weight, f.weight);
      d.holders.push({ name: m.name, score: f.score });
      dims.set(f.dimension, d);
    }
    if (m.dimensionGap) {
      const g = m.dimensionGap;
      const d = dims.get(g.dimension) ?? { weight: 0, holders: [] };
      d.weight = Math.max(d.weight, g.weight);
      dims.set(g.dimension, d);
    }
  }

  const ranked = [...dims.entries()]
    .filter(([, d]) => d.weight >= SENSITIVITY_WEIGHT_FLOOR)
    // Weight first; on ties the SCARCER dimension leads (fewer projects can
    // answer it) — at equal importance, absence is the more decision-relevant
    // truth to speak to.
    .sort((a, b) => b[1].weight - a[1].weight || a[1].holders.length - b[1].holders.length);
  const top = ranked[0];
  if (!top) return '';

  const [topDim, topData] = top;
  if (topData.holders.length === 0) {
    // The buyer's bar is blind across the whole shortlist.
    const leader = matches[0]?.name;
    return leader
      ? `None of these has ${noun(topDim)} on file yet — I've flagged that to our records team. On what's on file today, *${leader}* leads.`
      : '';
  }

  const best = (holders: Array<{ name: string; score: number }>) =>
    holders.reduce((a, b) => (b.score > a.score ? b : a));
  const topLeader = best(topData.holders);
  const fork = ranked.slice(1).find(([, d]) => d.holders.length > 0 && best(d.holders).name !== topLeader.name);
  if (fork) {
    const [forkDim, forkData] = fork;
    return `If ${noun(topDim)} rules, *${topLeader.name}* leads today; if ${noun(forkDim)} matters more, *${best(forkData.holders).name}*.`;
  }
  return `On ${noun(topDim)}, *${topLeader.name}* leads today.`;
}
