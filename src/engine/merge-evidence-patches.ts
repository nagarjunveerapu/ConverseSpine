import type { EvidenceSet } from './types.js';

/**
 * Merge independent EvidenceSet patches from parallel Desk fetches.
 * Fixed patch order (caller-controlled) preserves serial merge semantics;
 * Promise settlement order must not decide field winners.
 */
export function mergeEvidencePatches(
  base: EvidenceSet,
  patches: readonly EvidenceSet[],
): EvidenceSet {
  let out: EvidenceSet = {
    ...base,
    tools: [...(base.tools ?? [])],
    ...(base.toolLatencyMs ? { toolLatencyMs: { ...base.toolLatencyMs } } : {}),
    ...(base.toolFailureReason ? { toolFailureReason: { ...base.toolFailureReason } } : {}),
  };
  for (const p of patches) {
    if (!p) continue;
    for (const key of Object.keys(p) as (keyof EvidenceSet)[]) {
      if (key === 'tools' || key === 'toolLatencyMs' || key === 'toolFailureReason') continue;
      const v = p[key];
      if (v !== undefined) {
        (out as unknown as Record<string, unknown>)[key] = v;
      }
    }
    if (p.tools?.length) {
      out.tools = [...new Set([...(out.tools ?? []), ...p.tools])];
    }
    if (p.toolLatencyMs && Object.keys(p.toolLatencyMs).length) {
      out.toolLatencyMs = { ...(out.toolLatencyMs ?? {}), ...p.toolLatencyMs };
    }
    if (p.toolFailureReason && Object.keys(p.toolFailureReason).length) {
      out.toolFailureReason = { ...(out.toolFailureReason ?? {}), ...p.toolFailureReason };
    }
  }
  return out;
}
