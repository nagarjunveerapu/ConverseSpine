import { describe, expect, it } from 'vitest';
import { applyFailureFlagOverlay } from '../src/runtime/failure-flags.js';
import type { EngineDeps } from '../src/engine/ports.js';

function baseDeps(partial: Partial<EngineDeps> = {}): EngineDeps {
  return {
    data: {} as EngineDeps['data'],
    crm: {} as EngineDeps['crm'],
    llm: {} as EngineDeps['llm'],
    store: {} as EngineDeps['store'],
    clock: { nowMs: () => 0, nowIso: () => '' },
    failureLog: true,
    failureTools: true,
    failureRouting: true,
    failureSearch: true,
    failureAnswer: true,
    routingEnv: { FAILURE_ROUTING: 'true' } as EngineDeps['routingEnv'],
    ...partial,
  };
}

describe('failure flag KV overlay', () => {
  it('force-off only — true values in overlay are ignored by apply', () => {
    const deps = applyFailureFlagOverlay(baseDeps(), {
      FAILURE_ANSWER: false,
    });
    expect(deps.failureAnswer).toBe(false);
    expect(deps.failureSearch).toBe(true);
  });

  it('clears FAILURE_ROUTING on routingEnv when forced off', () => {
    const deps = applyFailureFlagOverlay(baseDeps(), { FAILURE_ROUTING: false });
    expect(deps.failureRouting).toBe(false);
    expect(deps.routingEnv?.FAILURE_ROUTING).toBe('false');
  });
});
