/**
 * SA-1 — extract permissions from resolved speech act.
 * act=`answer` must not write search constraints from facet nouns (plot sizes → propertyType).
 */
import type { Extracted } from '../types.js';
import type { ChipResolution, SpeechActKind } from './types.js';

const ANSWER_LIKE: ReadonlySet<SpeechActKind> = new Set([
  'answer',
  'compare',
  'visit_book',
  'visit_recall',
  'object',
  'handoff',
  'stop',
  'greet',
  'switch',
]);

/** Acts that may write brief/search constraints. */
export function mayWriteSearchConstraints(act: SpeechActKind): boolean {
  return act === 'search' || act === 'unknown';
}

/**
 * Strip constraint fields that answer/facet turns must not own.
 * Keeps namedProjects / topics / visit flags.
 */
export function applySpeechActPermissions(
  extracted: Extracted,
  resolution: ChipResolution,
): Extracted {
  const act = resolution.speechAct;
  if (mayWriteSearchConstraints(act)) return extracted;

  if (!ANSWER_LIKE.has(act) && act !== 'unknown') return extracted;

  // unknown: conservative — if we have answer topics, still block type/loc from facet collision
  const topics = extracted.askTopics ?? (extracted.askTopic ? [extracted.askTopic] : []);
  const treatAsAnswer =
    act === 'answer' ||
    act === 'compare' ||
    act === 'switch' ||
    (act === 'unknown' && topics.length > 0);

  if (!treatAsAnswer && act !== 'visit_book' && act !== 'visit_recall' && act !== 'object') {
    return extracted;
  }

  const constraints = { ...extracted.constraints };
  let changed = false;

  if (treatAsAnswer || act === 'visit_book' || act === 'visit_recall' || act === 'object') {
    if (constraints.propertyType !== undefined) {
      delete constraints.propertyType;
      changed = true;
    }
    // Facet nouns must not rewrite location (plot sizes / legal / price)
    if (treatAsAnswer && constraints.location !== undefined) {
      delete constraints.location;
      changed = true;
    }
  }

  if (!changed) return extracted;
  return { ...extracted, constraints };
}

/** True when free-text chip resolve says this is not a search pivot. */
export function isNonSearchSpeechAct(act: SpeechActKind): boolean {
  return ANSWER_LIKE.has(act);
}
