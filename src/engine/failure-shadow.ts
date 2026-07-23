import type { Failure } from './outcome.js';
import type { EvidenceSet, RelaxedDimension, TurnGoal } from './types.js';

function nearest(
  projectId: string | undefined,
  name: string,
  display: string,
): NonNullable<Failure['nearest']> {
  return { projectId: projectId ?? '', name, display };
}

function blockingDimensions(
  blocking: NonNullable<EvidenceSet['constraintGap']>['blocking'],
): RelaxedDimension[] {
  if (blocking === 'bhk') return ['size'];
  if (blocking === 'budget') return ['budget'];
  return ['size', 'budget'];
}

/**
 * Phase 0 shadow projection.
 *
 * It derives only issues already proven by structured evidence. It does not
 * guess from buyer text, route confidence, or reply copy, and it never changes
 * the goal/evidence/state used by the buyer turn.
 */
export function deriveShadowFailures(input: {
  goal: TurnGoal;
  evidence: EvidenceSet;
  droppedLocation?: boolean;
}): Failure[] {
  const { goal, evidence, droppedLocation } = input;
  const failures: Failure[] = [];
  const relaxed = new Set<RelaxedDimension>(evidence.relaxed ?? []);
  if (droppedLocation) relaxed.add('area');

  if (relaxed.size) {
    failures.push({
      kind: 'relaxed',
      stage: 'search',
      subject: 'recommendation',
      dimensions: [...relaxed],
      ...(droppedLocation
        ? { detail: { event: 'desk_unrecognized_location_drop' } }
        : {}),
    });
  }

  if (evidence.budgetGap) {
    failures.push({
      kind: 'no_match',
      stage: 'search',
      subject: 'budget',
      dimensions: ['budget'],
      nearest: nearest(
        evidence.budgetGap.closestProjectId,
        evidence.budgetGap.closestName,
        evidence.budgetGap.closestDisplay,
      ),
    });
  } else if (evidence.propertyTypeGap) {
    failures.push({
      kind: 'no_match',
      stage: 'search',
      subject: 'property_type',
      nearest: nearest(
        evidence.propertyTypeGap.closestProjectId,
        evidence.propertyTypeGap.closestName,
        evidence.propertyTypeGap.closestDisplay,
      ),
    });
  } else if (evidence.constraintGap) {
    failures.push({
      kind: 'no_match',
      stage: 'search',
      subject: 'constraints',
      dimensions: blockingDimensions(evidence.constraintGap.blocking),
      ...(evidence.constraintGap.alternateProject && evidence.constraintGap.alternatePriceDisplay
        ? {
            nearest: nearest(
              evidence.constraintGap.alternateProjectId,
              evidence.constraintGap.alternateProject,
              evidence.constraintGap.alternatePriceDisplay,
            ),
          }
        : {}),
    });
  } else if (goal.kind === 'no_fit' && evidence.noMatch) {
    failures.push({
      kind: 'no_match',
      stage: 'search',
      subject: 'recommendation',
    });
  }

  for (const key of evidence.faqMiss?.keys ?? []) {
    failures.push({
      kind: 'no_data',
      stage: 'tool',
      subject: key,
    });
  }

  return failures;
}
