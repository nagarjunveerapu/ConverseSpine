import { detectFocusedSwitchIntent } from '../engine/project_switch.js';
import type {
  ConversationState,
  EvidenceSet,
  Extracted,
  TurnDebug,
  TurnGoal,
} from '../engine/types.js';
import type { TurnIntentChannel } from '../engine/turn-intent/types.js';
import type { LocalTurnLogEntry } from './local-turn-log.js';

export function buildTurnLogSnapshot(input: {
  turnInput: {
    channel?: TurnIntentChannel;
    action_id?: string;
  };
  state: ConversationState;
  ex: Extracted;
  goal: TurnGoal;
  debug: TurnDebug;
  reply: string;
  evidence: EvidenceSet;
  buyerText: string;
  exit?: string;
}): LocalTurnLogEntry {
  const { turnInput, state, ex, goal, debug, reply, evidence, buyerText, exit } = input;
  const switchIntent =
    state.phase === 'focused' ? detectFocusedSwitchIntent(buyerText, ex, state) : null;

  return {
    ts: new Date().toISOString(),
    conv_id: state.convId,
    turn_index: state.turnCount,
    channel: turnInput.channel ?? 'whatsapp',
    input_source: debug.input_source,
    ...(turnInput.action_id ? { action_id: turnInput.action_id } : {}),
    buyer_text: buyerText,
    reply_preview: reply.slice(0, 280),
    phase: state.phase,
    ...(state.focus
      ? { focus: { project_id: state.focus.projectId, name: state.focus.projectName } }
      : {}),
    constraints: { ...state.constraints },
    last_offered: state.discover.lastOffered.map((o) => ({
      project_id: o.projectId,
      name: o.name,
    })),
    extracted: {
      ...(ex.askTopics?.length ? { ask_topics: ex.askTopics } : {}),
      ...(ex.namedProjects?.length
        ? { named_projects: ex.namedProjects.map((p) => `${p.projectId}:${p.name}`) }
        : {}),
      ...(ex.pickName ? { pick_name: ex.pickName } : {}),
      ...(ex.transition && ex.transition !== 'none' ? { transition: ex.transition } : {}),
      ...(ex.affirm ? { affirm: true } : {}),
      ...(ex.wantsMore ? { wants_more: true } : {}),
      ...(Object.keys(ex.constraints).length ? { constraints: { ...ex.constraints } } : {}),
    },
    ...(switchIntent ? { switch_intent: switchIntent } : {}),
    goal,
    tools: evidence.tools ?? debug.tools ?? [],
    ...(debug.extract_provenance ? { extract_provenance: debug.extract_provenance } : {}),
    ...(state.rti?.lastRouting?.routing ? { routing: state.rti.lastRouting.routing } : {}),
    rti: {
      ...(state.rti?.lastUiMode ? { last_ui_mode: state.rti.lastUiMode } : {}),
      ...(state.rti?.lastGoalKind ? { last_goal_kind: state.rti.lastGoalKind } : {}),
      ...(state.rti?.pendingPrompt ? { pending_prompt: state.rti.pendingPrompt } : {}),
    },
    grounding: debug.grounding,
    ...(exit ? { exit } : {}),
  };
}
