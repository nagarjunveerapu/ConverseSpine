/**
 * P7 — server-driven Advisor UX directives (nba + checklist_snapshot).
 * Deterministic from phase / goal / state — SPA must apply, not invent board/chips.
 */
import type { ConversationState, TurnDebug, TurnGoal } from '../engine/types.js';

export type AdvisorNbaBoard = 'none' | 'matches' | 'project' | 'compare' | 'visit';
export type AdvisorNbaBoardTab = 'legal' | 'units' | 'price' | 'emi' | 'overview';

export interface AdvisorNba {
  chips: string[];
  board: AdvisorNbaBoard;
  board_tab?: AdvisorNbaBoardTab;
  board_project_id?: string;
}

export interface AdvisorChecklistSnapshot {
  phase: string;
  focus_project_id?: string;
  focus_project_name?: string;
  engaged_project_ids: string[];
}

function topicToTab(topic: string | undefined): AdvisorNbaBoardTab {
  switch (topic) {
    case 'price':
      return 'price';
    case 'emi':
      return 'emi';
    case 'availability':
    case 'property_type':
      return 'units';
    case 'legal':
    case 'amenities':
    case 'location':
      return 'legal';
    default:
      return 'overview';
  }
}

function goalProjectId(goal: TurnGoal): string | undefined {
  if ('projectId' in goal && typeof goal.projectId === 'string') return goal.projectId;
  return undefined;
}

function goalTopic(goal: TurnGoal): string | undefined {
  if ('topic' in goal && typeof goal.topic === 'string') return goal.topic;
  return undefined;
}

/** Engaged / explored ids — discover offers + focus, stable order. */
export function engagedProjectIds(state: ConversationState): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const o of state.discover.lastOffered) push(o.projectId);
  for (const d of state.discover.discussedProjects ?? []) push(d.projectId);
  push(state.focus?.projectId);
  return ids;
}

function chipsForGoal(state: ConversationState, goal: TurnGoal, board: AdvisorNbaBoard): string[] {
  const chips: string[] = [];
  const offered = state.discover.lastOffered;
  const focusName = state.focus?.projectName;

  switch (goal.kind) {
    case 'recommend':
    case 'ack_reject_recommend':
    case 'advance':
      if (offered.length >= 2) {
        chips.push(`Compare all ${Math.min(offered.length, 3)}`);
        chips.push(`Tell me about ${offered[0]!.name}`);
      } else if (offered.length === 1) {
        chips.push(`Tell me about ${offered[0]!.name}`);
      }
      chips.push('Show me more projects');
      chips.push('Plan a visit day');
      break;
    case 'no_fit':
      chips.push('Widen my search');
      chips.push('Change area');
      chips.push('Adjust budget');
      break;
    case 'answer': {
      const topic = goal.topic;
      if (topic === 'legal') chips.push('What banks?', 'Is EC clear?', 'Send brochure');
      else if (topic === 'price' || topic === 'emi') chips.push('Unit configurations', 'Send brochure', 'Plan a visit day');
      else if (topic === 'availability' || topic === 'property_type') chips.push('Starting prices', 'Send brochure', 'Plan a visit day');
      else if (topic === 'amenities' || topic === 'location') chips.push('Legal status', 'Starting prices', 'Plan a visit day');
      else chips.push('Starting prices', 'Legal status', 'Plan a visit day');
      chips.push('Back to my matches');
      if (offered.length >= 2) chips.push(`Compare all ${Math.min(offered.length, 3)}`);
      break;
    }
    case 'commit':
      chips.push('Starting prices', 'Legal status', 'Plan a visit day', 'Back to my matches');
      break;
    case 'clarify_project_pick':
      for (const o of offered.slice(0, 3)) chips.push(o.name);
      break;
    case 'visit_ask':
    case 'visit_propose':
    case 'propose_visit':
      chips.push('Saturday morning', 'Sunday', 'Back to my matches');
      break;
    case 'visit_booked':
      chips.push('Add another stop', 'Back to my matches');
      break;
    case 'visit_recall':
      chips.push('Plan a visit day', 'Back to my matches');
      break;
    case 'probe':
      chips.push('Show me options', 'I am still deciding');
      break;
    default:
      if (board === 'visit') chips.push('Saturday morning', 'Back to my matches');
      else if (board === 'compare') chips.push('Plan a visit day', 'Back to my matches');
      else if (board === 'project' && focusName) {
        chips.push('Starting prices', 'Legal status', 'Plan a visit day', 'Back to my matches');
      } else {
        chips.push('Show me more projects', 'Plan a visit day');
      }
  }

  // Dedupe, cap 6
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of chips) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= 6) break;
  }
  return out;
}

export function buildAdvisorNba(state: ConversationState, debug: TurnDebug): AdvisorNba {
  const goal = debug.goal;
  const pid = goalProjectId(goal) ?? state.focus?.projectId;

  let board: AdvisorNbaBoard = 'none';
  let board_tab: AdvisorNbaBoardTab | undefined;
  let board_project_id: string | undefined;

  if (goal.kind === 'visit_booked' || state.phase === 'visit') {
    board = 'visit';
  } else if (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend' || goal.kind === 'advance') {
    board = 'matches';
  } else if (goal.kind === 'answer' && goal.topic === 'compare') {
    board = 'compare';
  } else if (
    goal.kind === 'answer' ||
    goal.kind === 'commit' ||
    goal.kind === 'objection'
  ) {
    board = 'project';
    board_project_id = pid;
    board_tab = topicToTab(goalTopic(goal));
  } else if (goal.kind === 'visit_ask' || goal.kind === 'visit_propose' || goal.kind === 'propose_visit') {
    board = 'visit';
  } else if (state.phase === 'focused' && state.focus) {
    board = 'project';
    board_project_id = state.focus.projectId;
    board_tab = 'overview';
  } else if (state.phase === 'discover' && state.discover.lastOffered.length > 0) {
    board = 'matches';
  }

  // Compare matrix turns often use answer+compare or dedicated compare path
  if (debug.goal.kind === 'answer' && goalTopic(goal) === 'compare') {
    board = 'compare';
    board_tab = undefined;
    board_project_id = undefined;
  }

  const chips = chipsForGoal(state, goal, board);

  return {
    chips,
    board,
    ...(board_tab ? { board_tab } : {}),
    ...(board_project_id ? { board_project_id } : {}),
  };
}

export function buildChecklistSnapshot(state: ConversationState): AdvisorChecklistSnapshot {
  return {
    phase: state.phase,
    ...(state.focus?.projectId
      ? {
          focus_project_id: state.focus.projectId,
          focus_project_name: state.focus.projectName,
        }
      : {}),
    engaged_project_ids: engagedProjectIds(state),
  };
}
