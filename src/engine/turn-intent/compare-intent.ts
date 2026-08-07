import type { ConversationState, Extracted } from '../types.js';
import { currentShortlist, discussedList } from '../entity-store.js';

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
  // Hinglish among-shortlist — prepareCompareExtracted owns IDs; do NOT treat
  // as a fresh search. (Focus release for these is gated separately.)
  if (/\b(?:project|projects|inmein|inme|dono(?:\s+mein)?)\s+se\s+kaun\b/i.test(t)) return true;
  if (/\bkaun\s+better\b/i.test(t) && /\b(?:se|these|those|them|dono|projects?)\b/i.test(t)) {
    return true;
  }
  if (/\bvs\.?\s+these\b/i.test(t)) return true;
  // Stress corpus: "tradeoff/difference/which is better the top ones/these"
  if (
    /\b(?:trade-?off|difference|which\s+is\s+better|\bvs\.?\b)\b/i.test(t) &&
    /\b(?:top\s+ones?|these|those|them|both|shortlist|options?)\b/i.test(t)
  ) {
    return true;
  }
  if (/^(?:also[,:]?\s+|hey[,:]?\s+|quick\s+q\s*[—–-]?\s*|one\s+thing[:\s]+)?(?:need\s+a\s+)?(?:trade-?off|difference|which\s+is\s+better)\b/i.test(t)) {
    return true;
  }
  // "which location/area is better?" among the shortlist — not a focused overview.
  if (/\bwhich\s+(?:location|area|side|micro-?market)\s+is\s+better\b/i.test(t)) return true;
  if (/\b(?:location|area)\s+(?:is\s+)?better\b/i.test(t) && /\b(?:which|what)\b/i.test(t)) {
    return true;
  }
  // "which is better Cornerstone or Eldorado" / "Cornerstone or Eldorado — which better"
  if (
    /\bwhich\s+is\s+better\b/i.test(t) ||
    (/\bbetter\b/i.test(t) && /\bor\b/i.test(t) && /\b(?:which|what)\b/i.test(t))
  ) {
    return true;
  }
  // P1 residual: Hindi तुलना / Tamil எது better among shortlist.
  if (/तुलना/.test(t)) return true;
  if (/எது\s*better/i.test(t)) return true;
  return false;
}

/** Merge compare intent — prefer named pair, then discussed set, then shortlist. */
export function prepareCompareExtracted(
  text: string,
  state: ConversationState,
  ex: Extracted,
): Extracted {
  if (!isCompareAmongOfferedTurn(text)) return ex;
  const offered = currentShortlist(state);
  const discussed = discussedList(state);
  const topics = ex.askTopics?.length ? ex.askTopics : ex.askTopic ? [ex.askTopic] : [];
  const withCompare = topics.includes('compare') ? topics : (['compare', ...topics] as Extracted['askTopics']);

  // Named vector hits win. Do NOT overwrite with shortlist when names are absent —
  // leave compareProjectIds unset so resolveCompareProjectIds can use anaphora /
  // discussedProjects (e.g. "compare both" after Ayana + Krishnaja Q&A).
  let ids: string[] | undefined;
  if (ex.namedProjects && ex.namedProjects.length >= 2) {
    ids = ex.namedProjects.slice(0, 3).map((p) => p.projectId);
  } else if (ex.compareProjectIds && ex.compareProjectIds.length >= 2) {
    ids = ex.compareProjectIds;
  } else if (
    discussed.length >= 2 &&
    /\b(?:both|these|those|them|the\s+two|dono)\b/i.test(text)
  ) {
    ids = discussed.slice(0, 3).map((p) => p.projectId);
  } else if (
    offered.length >= 2 &&
    !/\b(?:both|these|those|them|the\s+two|dono)\b/i.test(text) &&
    // Explicit "compare A and B" — leave unset so resolveCompareProjectIds can
    // match names against discussed+shortlist (stale lastOffered often has Clarks).
    !/\band\b/i.test(text) &&
    (ex.namedProjects?.length ?? 0) !== 1
  ) {
    // Bare "compare" / "compare all" without anaphora → shortlist is fine.
    ids = offered.slice(0, 3).map((o) => o.projectId);
  }

  return {
    ...ex,
    askTopic: 'compare',
    askTopics: withCompare,
    ...(ids ? { compareProjectIds: ids } : {}),
    transition: 'none',
    wantsMore: false,
    budgetFitQuestion: undefined,
    budgetPickQuestion: undefined,
  };
}

/** When buyer already has a multi-project shortlist, do not emit budget-gap no_fit on compare-ish turns. */
export function shouldAllowBudgetGapNoFit(state: ConversationState, text: string): boolean {
  if (currentShortlist(state).length < 2) return true;
  if (isCompareAmongOfferedTurn(text)) return false;
  if (/\bcompare\b/i.test(text)) return false;
  return true;
}
