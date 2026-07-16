/**
 * Understanding Flywheel Wave C — overnight auto-teach with an EXACT
 * no-regression gate.
 *
 * The founder's standing decision: auto-promote clean wins. "Clean" is not a
 * vibe here — with a nearest-neighbor index, adding a vector changes a
 * prediction ONLY where the new vector becomes the top-1 match. So the gate
 * checks every candidate member against every frozen holdout probe:
 *
 *   a candidate REGRESSES probe h iff
 *     cos(candidate, h) > h's current live top score   (it becomes nn1)
 *     AND cos ≥ τ_bind                                  (it would actually bind)
 *     AND candidate.intent ≠ h's gold intent            (…to the wrong kind)
 *
 * Clusters with zero regressing members are provably safe → promoted as
 * 'flywheel_auto' via Desk (one-tap Undo on the board). Any regression →
 * the cluster stays pending, flagged for a human. After promotions, an
 * incremental rebuild ships the new rows — taught at 04:00, live at 04:05.
 *
 * Runs only when UNDERSTANDING_AUTO_TEACH=true AND SIL_CANONICAL_EMBED=true:
 * the gate embeds candidates canonically, so it only speaks for the canonical
 * index. Cost: ≤ (members + probes) embeds + probes nn1 queries, nightly.
 */

import type { Env } from '../env.js';
import { NayaDeskClient } from '../crm/nayadesk-client.js';
import { getQueryCanonicalizer } from '../nlu/vocab.js';
import { parseJsonl, rebuildIntentIndex, type RebuildReport } from '../rebuild/intent-index.js';

const DEFAULT_MODEL = '@cf/baai/bge-base-en-v1.5';
const TAU_BIND = 0.78;
const MIN_TEACHER_CONF = 0.85;
const MAX_CLUSTERS_PER_NIGHT = 20;
const MAX_HOLDOUT_PROBES = 300;
const EMBED_BATCH = 96;

// ── The pure gate ─────────────────────────────────────────────────────────

export interface GateProbe {
  gold_kind: string;
  /** Current top-1 score against the LIVE index ('-1' when index empty). */
  live_score: number;
  vec: ReadonlyArray<number>;
}

export interface GateMember {
  cluster_key: string;
  intent_kind: string;
  vec: ReadonlyArray<number>;
}

export interface ClusterVerdict {
  cluster_key: string;
  intent_kind: string;
  safe: boolean;
  regressions: number;
  improvements: number;
}

export function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Exact nn1 gate — pure, so every decision branch is unit-testable. */
export function gateCandidates(
  probes: ReadonlyArray<GateProbe>,
  members: ReadonlyArray<GateMember>,
  tau: number = TAU_BIND,
): ClusterVerdict[] {
  const byCluster = new Map<string, ClusterVerdict>();
  for (const m of members) {
    let v = byCluster.get(m.cluster_key);
    if (!v) {
      v = { cluster_key: m.cluster_key, intent_kind: m.intent_kind, safe: true, regressions: 0, improvements: 0 };
      byCluster.set(m.cluster_key, v);
    }
    for (const h of probes) {
      const s = cosine(m.vec, h.vec);
      // Only a new nn1 that would BIND can change behaviour.
      if (s <= h.live_score || s < tau) continue;
      if (m.intent_kind === h.gold_kind) v.improvements++;
      else v.regressions++;
    }
  }
  for (const v of byCluster.values()) v.safe = v.regressions === 0;
  return [...byCluster.values()];
}

// ── The nightly runner ────────────────────────────────────────────────────

export interface AutoTeachReport {
  ok: boolean;
  reason?: string;
  clusters: number;
  members: number;
  probes: number;
  promoted_clusters: number;
  flagged_clusters: number;
  desk: { promoted: number; failed: number; flagged: number } | null;
  rebuild: RebuildReport | null;
  errors: string[];
}

async function embedAll(env: Env, model: string, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const res = (await env.AI!.run(model as never, { text: texts.slice(i, i + EMBED_BATCH) })) as {
      data?: number[][];
    };
    out.push(...(res.data ?? []));
  }
  return out;
}

export async function runAutoTeach(env: Env): Promise<AutoTeachReport> {
  const base: AutoTeachReport = {
    ok: false, clusters: 0, members: 0, probes: 0,
    promoted_clusters: 0, flagged_clusters: 0, desk: null, rebuild: null, errors: [],
  };
  if (env.UNDERSTANDING_AUTO_TEACH !== 'true') return { ...base, ok: true, reason: 'disabled' };
  if (env.SIL_CANONICAL_EMBED !== 'true') return { ...base, reason: 'requires_canonical_mode' };
  if (!env.AI || !env.INTENT_VECTORS) return { ...base, reason: 'missing_bindings' };
  if (!env.SIL_REGISTRY_URL) return { ...base, reason: 'no_registry_url' };

  const model = env.SIL_EMBED_MODEL || DEFAULT_MODEL;
  const client = new NayaDeskClient(env);

  // 1) Candidates: teacher-confident pending clusters from Desk.
  let clusters: Array<{
    cluster_key: string; teacher_intent: string; teacher_confidence: number;
    members: Array<{ queue_id: string; buyer_text: string }>;
  }>;
  try {
    const res = await client.getAutoCandidates({ minConf: MIN_TEACHER_CONF, maxClusters: MAX_CLUSTERS_PER_NIGHT });
    clusters = res.clusters;
  } catch (e) {
    return { ...base, reason: `candidates_fetch_error:${(e as Error).message}` };
  }
  base.clusters = clusters.length;
  if (clusters.length === 0) return { ...base, ok: true, reason: 'no_candidates' };

  // 2) Frozen holdout probes from the registry (deterministic sample by id).
  let holdout: Array<{ phrasing: string; intent_kind: string }>;
  try {
    const res = await fetch(env.SIL_REGISTRY_URL);
    if (!res.ok) return { ...base, reason: `registry_fetch_${res.status}` };
    holdout = parseJsonl(await res.text())
      .filter((r) => r.eval_split === 'holdout' && r.phrasing && r.intent_kind && !r.is_negative)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, MAX_HOLDOUT_PROBES);
  } catch (e) {
    return { ...base, reason: `registry_fetch_error:${(e as Error).message}` };
  }
  if (holdout.length === 0) return { ...base, reason: 'no_holdout_probes' };
  base.probes = holdout.length;

  // 3) Canonicalize + embed — SAME masker + model as the live index.
  const canon = await getQueryCanonicalizer(env);
  const memberList = clusters.flatMap((c) =>
    c.members.map((m) => ({ cluster_key: c.cluster_key, intent_kind: c.teacher_intent, text: m.buyer_text })),
  );
  base.members = memberList.length;
  let memberVecs: number[][];
  let probeVecs: number[][];
  try {
    memberVecs = await embedAll(env, model, memberList.map((m) => canon(m.text)));
    probeVecs = await embedAll(env, model, holdout.map((h) => canon(h.phrasing)));
  } catch (e) {
    return { ...base, reason: `embed_error:${(e as Error).message}` };
  }
  if (memberVecs.length !== memberList.length || probeVecs.length !== holdout.length) {
    return { ...base, reason: 'embed_count_mismatch' };
  }

  // 4) Each probe's CURRENT top-1 against the live index.
  const probes: GateProbe[] = [];
  for (let i = 0; i < holdout.length; i++) {
    try {
      const q = (await env.INTENT_VECTORS.query(probeVecs[i]!, { topK: 1 })) as {
        matches?: Array<{ score?: number }>;
      };
      probes.push({
        gold_kind: holdout[i]!.intent_kind,
        live_score: q.matches?.[0]?.score ?? -1,
        vec: probeVecs[i]!,
      });
    } catch (e) {
      base.errors.push(`probe_query_${i}:${(e as Error).message}`);
    }
  }
  if (probes.length === 0) return { ...base, reason: 'probe_queries_failed' };

  // 5) The exact gate.
  const verdicts = gateCandidates(
    probes,
    memberList.map((m, i) => ({ cluster_key: m.cluster_key, intent_kind: m.intent_kind, vec: memberVecs[i]! })),
  );
  const safe = verdicts.filter((v) => v.safe);
  const risky = verdicts.filter((v) => !v.safe);
  base.promoted_clusters = safe.length;
  base.flagged_clusters = risky.length;

  // 6) Tell Desk. Promotions land as 'flywheel_auto' (one-tap Undo on the board).
  try {
    base.desk = await client.postAutoTeachDecisions({
      promote: safe.map((v) => ({
        cluster_key: v.cluster_key,
        reviewed_intent: v.intent_kind,
        note: `auto-teach: 0 regressions on ${probes.length} holdout probes` +
          (v.improvements ? `, ${v.improvements} improvements` : ''),
      })),
      flag: risky.map((v) => ({
        cluster_key: v.cluster_key,
        note: `auto-teach: held back — would flip ${v.regressions} holdout probe(s) wrong`,
      })),
    });
  } catch (e) {
    return { ...base, reason: `desk_callback_error:${(e as Error).message}` };
  }

  // 7) Ship: incremental rebuild picks up the freshly promoted feed rows.
  if ((base.desk?.promoted ?? 0) > 0) {
    try {
      base.rebuild = await rebuildIntentIndex(env);
    } catch (e) {
      base.errors.push(`rebuild:${(e as Error).message}`);
    }
  }

  base.ok = base.errors.length === 0;
  return base;
}
