import type { EngineData } from './ports.js';
import type { Failure, Outcome } from './outcome.js';

export interface ResolvedLocation {
  value: string;
  authority: 'resolved' | 'unavailable';
}

export function localityFailure(): Failure {
  return {
    kind: 'unresolvable',
    stage: 'extract',
    subject: 'locality',
  };
}

/**
 * The only boundary that may approve a location for durable search state.
 * Desk owns place truth. An unavailable resolver fails open because a transport
 * outage is not evidence that the buyer named an invalid place.
 */
export async function resolveDurableLocation(
  candidate: string,
  data: Pick<EngineData, 'resolveLocation'>,
): Promise<Outcome<ResolvedLocation>> {
  const parts = candidate
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return { ok: false, failure: localityFailure() };

  const canonical: string[] = [];
  let unavailable = false;
  for (const part of parts) {
    const resolution = await data.resolveLocation(part);
    if (resolution.status === 'unresolved') {
      return { ok: false, failure: localityFailure() };
    }
    if (resolution.status === 'unavailable') {
      unavailable = true;
      canonical.push(part);
      continue;
    }
    canonical.push(resolution.canonical);
  }

  return {
    ok: true,
    value: {
      value: [...new Set(canonical)].join(', '),
      authority: unavailable ? 'unavailable' : 'resolved',
    },
  };
}
