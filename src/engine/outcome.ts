import type { RelaxedDimension } from './types.js';

/**
 * The stage that could not fully deliver its contract.
 *
 * This is deliberately separate from `kind`: `no_data` at evidence fetch and
 * `no_data` at the compose contract have different owners.
 */
export type FailureStage =
  | 'extract'
  | 'route'
  | 'search'
  | 'tool'
  | 'compose'
  | 'destructive_gate';

export type FailureKind =
  | 'unresolvable'
  | 'no_data'
  | 'no_match'
  | 'relaxed'
  | 'unsupported'
  | 'missing_input'
  | 'ambiguous';

export interface Failure {
  kind: FailureKind;
  stage: FailureStage;
  /** Machine subject, never buyer copy. */
  subject: string;
  dimensions?: RelaxedDimension[];
  nearest?: { projectId: string; name: string; display: string };
  /** Internal diagnostics. Never persisted to the buyer-visible ledger. */
  detail?: Record<string, unknown>;
}

/**
 * A stage may succeed with non-terminal notices (for example, a disclosed
 * size relaxation) or fail terminally. This preserves useful partial answers
 * without allowing a substitute to masquerade as full success.
 */
export type Outcome<T> =
  | { ok: true; value: T; notices?: Failure[] }
  | { ok: false; failure: Failure };

export interface FailureSummary {
  kind: FailureKind;
  stage: FailureStage;
  subject: string;
  dimensions?: RelaxedDimension[];
}

export const ok = <T>(value: T, notices: Failure[] = []): Outcome<T> => ({
  ok: true,
  value,
  ...(notices.length ? { notices } : {}),
});

export const fail = (failure: Failure): Outcome<never> => ({ ok: false, failure });

/** Safe durable shape: deliberately excludes nearest and detail. */
export function summarizeFailure(failure: Failure): FailureSummary {
  return {
    kind: failure.kind,
    stage: failure.stage,
    subject: failure.subject,
    ...(failure.dimensions?.length
      ? { dimensions: [...new Set(failure.dimensions)] }
      : {}),
  };
}
