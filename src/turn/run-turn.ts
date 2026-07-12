import { postTurnEgress } from './egress.js';
import type { ConverseRuntime } from '../runtime/deps.js';
import { runEngineTurn } from '../engine/turn.js';
import type { TurnInput, TurnResult } from '../types.js';

/**
 * ConverseEngine turn entry — replaces legacy intent→composer spine.
 */
export async function runTurn(
  rt: ConverseRuntime,
  input: TurnInput,
  ctx?: ExecutionContext,
): Promise<TurnResult> {
  const { conversation_id, buyer_text, builder_id, buyer_phone } = input;

  const result = await runEngineTurn(
    {
      convId: conversation_id,
      builderId: builder_id ?? rt.defaultBuilderId(),
      text: buyer_text,
      buyerPhone: buyer_phone ?? `web:${conversation_id}`,
      // W6 — the engine's channel is TurnIntentChannel (chip/action budgets
      // only — advisor gets wider menus). 'api' callers keep the tight
      // whatsapp budgets they always had; the CRM door label ('api', 'whatsapp',
      // 'advisor_web') flows independently via upsertLead → Desk. Zero
      // behavior change for existing doors.
      channel: input.channel === 'advisor_web' ? 'advisor_web' : 'whatsapp',
      action_id: input.action_id,
    },
    rt.engine,
  );

  rt.trace.traceTurn(ctx, {
    conversation_id,
    turn_index: result.state.turnCount,
    buyer_text,
    reply_text: result.reply,
    composer: result.debug.goal.kind,
    spans: [
      { name: 'engine', output: result.debug },
      { name: 'phase', output: result.state.phase },
    ],
  });

  if (result.state.ndConversationId) {
    postTurnEgress(rt, ctx, {
      builder_id: result.state.builderId,
      buyer_phone: result.state.ndBuyerPhone ?? buyer_phone ?? '',
      conversation_id: result.state.ndConversationId,
      buyer_text,
      understood: { intents: [{ kind: result.debug.goal.kind }], slot_writes: [] },
      visitBooked: result.debug.goal.kind === 'visit_booked',
      project_id: result.state.focus?.projectId,
    });
  }

  return {
    reply_text: result.reply,
    composer: result.debug.goal.kind,
    turn_index: result.state.turnCount,
    ...(result.whatsappActions ? { whatsapp_actions: result.whatsappActions } : {}),
    debug: {
      phase: result.debug.phase,
      goal: result.debug.goal,
      tools: result.debug.tools,
      grounding: result.debug.grounding,
      ...(result.debug.speech_act ? { speech_act: result.debug.speech_act } : {}),
      ...(result.debug.extract_provenance
        ? { extract_provenance: result.debug.extract_provenance }
        : {}),
    },
  };
}

export async function bootDemo(rt: ConverseRuntime, buyerPhone?: string): Promise<string> {
  await rt.crm.health();
  const phone = buyerPhone ?? '+919990000001';
  const builderId = rt.defaultBuilderId();
  const upsert = await rt.crm.upsertLead({ builder_id: builderId, buyer_phone: phone });
  return upsert.conversation_id;
}
