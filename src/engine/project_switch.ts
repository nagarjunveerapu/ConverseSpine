/**
 * Focused-phase project switch — resolve a named alternate project via
 * in-memory pool or NayaDesk search_text, then commit-project.
 */
import type { AnswerTopic, ConversationState, Extracted, OfferedProject, TurnGoal } from './types.js';
import type { EngineDeps } from './ports.js';

export interface SwitchIntent {
  readonly searchText: string;
  readonly followUp?: AnswerTopic;
  readonly followUpTopics?: AnswerTopic[];
}

function stripBuilderPrefix(name: string): string {
  return name.replace(/^(brigade|lokations)\s+/i, '').trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = stripBuilderPrefix(a).toLowerCase();
  const nb = stripBuilderPrefix(b).toLowerCase();
  if (na === nb) return true;
  const ta = na.split(/\s+/)[0] ?? '';
  const tb = nb.split(/\s+/)[0] ?? '';
  if (ta.length >= 4 && tb.length >= 4 && (na.includes(tb) || nb.includes(ta))) return true;
  return false;
}

function poolOf(s: ConversationState): OfferedProject[] {
  const pool = [...s.discover.lastOffered];
  if (s.focus && !pool.some((p) => p.projectId === s.focus!.projectId)) {
    pool.push({ projectId: s.focus.projectId, name: s.focus.projectName });
  }
  return pool;
}

function findInPool(pool: readonly OfferedProject[], needle: string): OfferedProject | null {
  const n = needle.toLowerCase();
  for (const o of pool) {
    const distinctive = stripBuilderPrefix(o.name).toLowerCase();
    const firstTok = distinctive.split(/\s+/)[0] ?? '';
    if (n.includes(distinctive) || distinctive.includes(n) || (firstTok.length >= 4 && n.includes(firstTok))) {
      return o;
    }
  }
  return null;
}

function extractAlternateProjectName(text: string, focusName: string): string | undefined {
  const about =
    /\b(?:what about|how about|tell me about|more about|info on|interested in|know about|switch to|show me)\s+([A-Za-z][A-Za-z0-9\s'-]{2,40}?)(?:\?|\.|!|$|\s+(?:please|project))/i.exec(
      text,
    );
  if (about?.[1]) {
    const n = about[1].trim();
    if (!/^(?:the|this)\s+project$/i.test(n) && !namesMatch(n, focusName)) return n;
  }

  const topicTail =
    /^([A-Za-z][A-Za-z0-9\s'-]{2,40}?)\s+(?:pricing|price|legal|rera|location|brochure|visit|details?|overview)\b/i.exec(
      text.trim(),
    );
  if (topicTail?.[1]) {
    const n = topicTail[1].trim();
    if (!namesMatch(n, focusName)) return n;
  }

  const bare = text.trim();
  if (
    /^[A-Za-z][A-Za-z0-9\s'-]{2,40}$/.test(bare) &&
    bare.split(/\s+/).length <= 4 &&
    !/^(yes|no|ok|okay|thanks|thank you|pricing|legal|compare|hi|hello)$/i.test(bare) &&
    !namesMatch(bare, focusName)
  ) {
    return bare;
  }
  return undefined;
}

function followUpTopics(ex: Extracted): { followUp?: AnswerTopic; followUpTopics?: AnswerTopic[] } {
  const topics = ex.askTopics?.length ? ex.askTopics.filter((t) => t !== 'compare') : [];
  if (topics.length) return { followUp: topics[0], followUpTopics: topics };
  if (ex.askTopic && ex.askTopic !== 'compare') return { followUp: ex.askTopic };
  if (ex.transition === 'want_details') return { followUp: 'overview' };
  return { followUp: 'overview' };
}

/** Sync detection — returns null when no switch or when compare/handoff paths own the turn. */
export function detectFocusedSwitchIntent(
  text: string,
  ex: Extracted,
  s: ConversationState,
): SwitchIntent | { commit: OfferedProject; followUp?: AnswerTopic; followUpTopics?: AnswerTopic[] } | null {
  if (!s.focus) return null;
  if (ex.recall || ex.stop || ex.transition === 'see_others' || ex.wantsMore || ex.transition === 'want_visit') {
    return null;
  }
  if ((ex.compareProjectIds?.length ?? 0) >= 2) return null;
  if (ex.askTopic === 'compare' && (ex.compareProjectIds?.length ?? 0) >= 2) return null;

  const focus = s.focus;
  const pool = poolOf(s);
  const fu = followUpTopics(ex);

  if (ex.namedProjects?.length === 1) {
    const n = ex.namedProjects[0]!;
    if (n.projectId !== focus.projectId) return { commit: n, ...fu };
    return null;
  }

  if (ex.pickName && !namesMatch(ex.pickName, focus.projectName)) {
    const hit = findInPool(pool, ex.pickName);
    if (hit && hit.projectId !== focus.projectId) return { commit: hit, ...fu };
    return { searchText: ex.pickName, ...fu };
  }

  const alt = extractAlternateProjectName(text, focus.projectName);
  if (alt) {
    const hit = findInPool(pool, alt);
    if (hit && hit.projectId !== focus.projectId) return { commit: hit, ...fu };
    return { searchText: alt, ...fu };
  }

  return null;
}

export async function resolveFocusedSwitchGoal(
  text: string,
  ex: Extracted,
  s: ConversationState,
  deps: EngineDeps,
): Promise<TurnGoal | null> {
  const intent = detectFocusedSwitchIntent(text, ex, s);
  if (!intent) return null;

  if ('commit' in intent) {
    const { commit, followUp, followUpTopics } = intent;
    return {
      kind: 'commit',
      projectId: commit.projectId,
      projectName: commit.name,
      ...(followUp ? { followUp } : {}),
      ...(followUpTopics?.length ? { followUpTopics } : {}),
    };
  }

  const search = await deps.data
    .search(s.builderId, { searchText: intent.searchText, maxResults: 3 })
    .catch(() => ({ matches: [] as Array<{ project_id: string; name: string }> }));

  const needle = intent.searchText.toLowerCase();
  const ranked = search.matches
    .map((m) => {
      const name = m.name.toLowerCase();
      const score =
        name === needle ? 3 : name.includes(needle) || needle.includes(name.split(/\s+/)[0] ?? '') ? 2 : 1;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.m;
  if (!best || best.project_id === s.focus!.projectId) return null;

  return {
    kind: 'commit',
    projectId: best.project_id,
    projectName: best.name,
    ...(intent.followUp ? { followUp: intent.followUp } : {}),
    ...(intent.followUpTopics?.length ? { followUpTopics: intent.followUpTopics } : {}),
  };
}
