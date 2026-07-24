import * as discover from './phases/discover.js';
import type { Failure, Outcome } from './outcome.js';
import type {
  ConstraintAuthority,
  ConstraintAuthorityKey,
  Constraints,
  Match,
  RelaxedDimension,
  SearchFilters,
} from './types.js';

export interface SearchAttempt {
  matches: Match[];
  recognizedLocations?: string[];
}

interface SearchInput {
  filters: SearchFilters;
  constraints: Constraints;
  authority?: Partial<Record<ConstraintAuthorityKey, ConstraintAuthority>>;
  rejectedProjectIds: readonly string[];
  search: (filters: SearchFilters) => Promise<SearchAttempt>;
}

function constraintsAfter(
  source: Constraints,
  relaxed: readonly RelaxedDimension[],
): Constraints {
  const next = { ...source };
  if (relaxed.includes('type')) delete next.propertyType;
  if (relaxed.includes('size')) delete next.bhk;
  if (relaxed.includes('area')) delete next.location;
  if (relaxed.includes('budget')) {
    delete next.budgetMinInr;
    delete next.budgetMaxInr;
  }
  return next;
}

function relaxedNotice(dimensions: RelaxedDimension[]): Failure {
  return {
    kind: 'relaxed',
    stage: 'search',
    subject: 'constraints',
    dimensions,
  };
}

function noMatchFailure(
  subject: string,
  nearest?: Match,
): Failure {
  return {
    kind: 'no_match',
    stage: 'search',
    subject,
    ...(nearest
      ? {
          nearest: {
            projectId: nearest.projectId,
            name: nearest.name,
            display: nearest.startingPriceDisplay,
          },
        }
      : {}),
  };
}

function withoutBudget(filters: SearchFilters): SearchFilters {
  const {
    budgetMinInr: _min,
    budgetMaxInr: _max,
    budgetTargetInr: _target,
    ...next
  } = filters;
  return next;
}

/**
 * Phase 3 zero-match ladder. It mutates only a local filter copy; the durable
 * buyer brief is read-only. Declared property type is never released.
 *
 * Hardness (LLD §4.2): size before area/budget. Prefer locality budget-nearest
 * over silent area release. Empty recognized locality → area no_match (honest
 * coverage recovery), never a corridor dump.
 */
export async function searchWithAuthorityRelaxation(
  input: SearchInput,
): Promise<Outcome<{ matches: Match[]; relaxed: RelaxedDimension[] }>> {
  let filters = { ...input.filters };
  const relaxed: RelaxedDimension[] = [];

  const attempt = async (
    extraRelaxed: readonly RelaxedDimension[] = [],
  ): Promise<Match[]> => {
    const result = await input.search(filters);
    return discover.filterSearchMatches(
      result.matches,
      constraintsAfter(input.constraints, [...relaxed, ...extraRelaxed]),
      input.rejectedProjectIds,
    );
  };

  if (
    filters.projectTypes &&
    input.authority?.propertyType === 'inferred'
  ) {
    const { projectTypes: _ignored, ...next } = filters;
    filters = next;
    relaxed.push('type');
    const matches = await attempt();
    if (matches.length) {
      return { ok: true, value: { matches, relaxed }, notices: [relaxedNotice(relaxed)] };
    }
  }

  if (filters.bhks) {
    const { bhks: _ignored, ...next } = filters;
    filters = next;
    relaxed.push('size');
    const matches = await attempt();
    if (matches.length) {
      return { ok: true, value: { matches, relaxed }, notices: [relaxedNotice(relaxed)] };
    }
  }

  // Location still on the brief: never silently drop area to list other corridors.
  if (filters.locations) {
    const hadBudget =
      filters.budgetMinInr !== undefined || filters.budgetMaxInr !== undefined;
    if (hadBudget) {
      const saved = filters;
      filters = withoutBudget(filters);
      const localityHits = await attempt(['budget']);
      filters = saved;
      if (localityHits.length) {
        return { ok: false, failure: noMatchFailure('budget', localityHits[0]) };
      }
    } else {
      // No budget on brief — confirm locality is empty at remaining filters.
      const localityHits = await attempt();
      if (localityHits.length) {
        return {
          ok: true,
          value: { matches: localityHits, relaxed },
          notices: relaxed.length ? [relaxedNotice(relaxed)] : undefined,
        };
      }
    }
    return { ok: false, failure: noMatchFailure('area') };
  }

  if (filters.budgetMinInr !== undefined || filters.budgetMaxInr !== undefined) {
    filters = withoutBudget(filters);
    relaxed.push('budget');
    const nearest = (await attempt())[0];
    return { ok: false, failure: noMatchFailure('budget', nearest) };
  }

  return { ok: false, failure: noMatchFailure('constraints') };
}
