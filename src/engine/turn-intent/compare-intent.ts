import type { ConversationState, Extracted } from '../types.js';

/** Compare / shortlist hub turns — must bypass RTI recovery and use lastOffered, not re-search no_fit. */
export function isCompareAmongOfferedTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bcompare\s+all\b/i.test(t)) return true;
  if (/\b(?:side\s+by\s+side|compare)\b/i.test(t) && /\b(?:all|both|three|3|two|2)\b/i.test(t)) {
    return true;
  }
  if (/\bcompare\b/i.test(t)) return true;
  if (/\b(?:add|include)\b.+\bcompar(?:e|ison|ision)\b/i.test(t)) return true;
  if (/\bcompar(?:e|ison|ision)\b.+\b(?:add|include)\b/i.test(t)) return true;
  return false;
}

/** Merge compare intent with the current shortlist (project-agnostic). */
export function prepareCompareExtracted(
  text: string,
  state: ConversationState,
  ex: Extracted,
): Extracted {
  if (!isCompareAmongOfferedTurn(text)) return ex;
  const offered = state.discover.lastOffered;
  if (offered.length < 2) return ex;
  const ids = offered.slice(0, 3).map((o) => o.projectId);
  const topics = ex.askTopics?.length ? ex.askTopics : ex.askTopic ? [ex.askTopic] : [];
  const withCompare = topics.includes('compare') ? topics : (['compare', ...topics] as Extracted['askTopics']);
  return {
    ...ex,
    askTopic: 'compare',
    askTopics: withCompare,
    compareProjectIds: ids,
    transition: 'none',
    wantsMore: false,
    budgetFitQuestion: undefined,
    budgetPickQuestion: undefined,
  };
}

/** When buyer already has a multi-project shortlist, do not emit budget-gap no_fit on compare-ish turns. */
export function shouldAllowBudgetGapNoFit(state: ConversationState, text: string): boolean {
  if (state.discover.lastOffered.length < 2) return true;
  if (isCompareAmongOfferedTurn(text)) return false;
  if (/\bcompare\b/i.test(text)) return false;
  return true;
}
