/**
 * Focused-phase project switch — commit when PROJECT_VECTORS fills namedProjects.
 */
import type { AnswerTopic, ConversationState, Extracted, OfferedProject, TurnGoal } from './types.js';
import type { EngineDeps } from './ports.js';

export interface SwitchIntent {
  readonly followUp?: AnswerTopic;
  readonly followUpTopics?: AnswerTopic[];
}

function followUpTopics(ex: Extracted): { followUp?: AnswerTopic; followUpTopics?: AnswerTopic[] } {
  const topics = ex.askTopics?.length ? ex.askTopics.filter((t) => t !== 'compare') : [];
  if (topics.length) return { followUp: topics[0], followUpTopics: topics };
  if (ex.askTopic && ex.askTopic !== 'compare') return { followUp: ex.askTopic };
  if (ex.transition === 'want_details') return { followUp: 'overview' };
  return { followUp: 'overview' };
}

function exactPoolPick(pool: readonly OfferedProject[], pickName: string): OfferedProject | null {
  const needle = pickName.trim().toLowerCase();
  for (const o of pool) {
    if (o.name.trim().toLowerCase() === needle) return o;
  }
  return null;
}

function poolOf(s: ConversationState): OfferedProject[] {
  const pool = [...s.discover.lastOffered];
  if (s.focus && !pool.some((p) => p.projectId === s.focus!.projectId)) {
    pool.push({ projectId: s.focus.projectId, name: s.focus.projectName });
  }
  return pool;
}

/** Sync detection — returns null when no switch or when compare/handoff paths own the turn. */
export function detectFocusedSwitchIntent(
  _text: string,
  ex: Extracted,
  s: ConversationState,
): (SwitchIntent & { commit: OfferedProject }) | null {
  if (!s.focus) return null;
  if (ex.recall || ex.stop || ex.transition === 'see_others' || ex.wantsMore || ex.transition === 'want_visit') {
    return null;
  }
  if ((ex.compareProjectIds?.length ?? 0) >= 2) return null;
  if (ex.askTopic === 'compare' && (ex.compareProjectIds?.length ?? 0) >= 2) return null;
  // Two named projects → compare path owns the turn, not a single-project switch.
  if ((ex.namedProjects?.length ?? 0) >= 2) return null;

  const focus = s.focus;
  const fu = followUpTopics(ex);

  const named = ex.namedProjects;
  if (named && named.length >= 1) {
    const n = named[0];
    if (!n) return null;
    if (n.projectId !== focus.projectId) return { commit: n, ...fu };
    return null;
  }

  if (ex.pickName) {
    const hit = exactPoolPick(poolOf(s), ex.pickName);
    if (hit && hit.projectId !== focus.projectId) return { commit: hit, ...fu };
  }

  return null;
}

export async function resolveFocusedSwitchGoal(
  text: string,
  ex: Extracted,
  s: ConversationState,
  _deps: EngineDeps,
): Promise<TurnGoal | null> {
  const intent = detectFocusedSwitchIntent(text, ex, s);
  if (!intent) return null;

  const { commit, followUp, followUpTopics: fuTopics } = intent;
  return {
    kind: 'commit',
    projectId: commit.projectId,
    projectName: commit.name,
    ...(followUp ? { followUp } : {}),
    ...(fuTopics?.length ? { followUpTopics: fuTopics } : {}),
  };
}
