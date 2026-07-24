import type { Env } from '../env.js';
import type { EngineDeps } from '../engine/ports.js';

/** KV key — JSON object of Failure flag names to boolean. Only `false` forces off. */
export const FAILURE_FLAGS_KV_KEY = 'runtime:failure_flags';

export type FailureFlagName =
  | 'FAILURE_LOG'
  | 'FAILURE_TOOLS'
  | 'FAILURE_ROUTING'
  | 'FAILURE_SEARCH'
  | 'FAILURE_ANSWER';

export type FailureFlagOverlay = Partial<Record<FailureFlagName, boolean>>;

/**
 * Runtime kill switch for Failure-as-a-value flags.
 *
 * Wrangler env turns flags ON. KV may only force them OFF (never force-on),
 * so a bad soak can be killed without waiting on a full deploy pipeline —
 * still a KV write, not a magical remote, but no code change required.
 */
export async function loadFailureFlagOverlay(
  kv: Env['TURN_CACHE'] | undefined,
): Promise<FailureFlagOverlay | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(FAILURE_FLAGS_KV_KEY, 'json');
    if (!raw || typeof raw !== 'object') return null;
    const out: FailureFlagOverlay = {};
    for (const key of [
      'FAILURE_LOG',
      'FAILURE_TOOLS',
      'FAILURE_ROUTING',
      'FAILURE_SEARCH',
      'FAILURE_ANSWER',
    ] as const) {
      if ((raw as Record<string, unknown>)[key] === false) out[key] = false;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** Apply force-off overlay onto deps built from wrangler env. */
export function applyFailureFlagOverlay(
  deps: EngineDeps,
  overlay: FailureFlagOverlay | null,
): EngineDeps {
  if (!overlay) return deps;
  const next: EngineDeps = { ...deps };
  if (overlay.FAILURE_LOG === false) next.failureLog = false;
  if (overlay.FAILURE_TOOLS === false) next.failureTools = false;
  if (overlay.FAILURE_ROUTING === false) {
    next.failureRouting = false;
    if (next.routingEnv) {
      next.routingEnv = { ...next.routingEnv, FAILURE_ROUTING: 'false' };
    }
  }
  if (overlay.FAILURE_SEARCH === false) next.failureSearch = false;
  if (overlay.FAILURE_ANSWER === false) next.failureAnswer = false;
  return next;
}

export async function engineDepsWithRuntimeFlags(
  env: Env,
  deps: EngineDeps,
): Promise<EngineDeps> {
  const overlay = await loadFailureFlagOverlay(env.TURN_CACHE);
  return applyFailureFlagOverlay(deps, overlay);
}
