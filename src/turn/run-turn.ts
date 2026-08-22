import { postTurnEgress } from './egress.js';
import type { ConverseRuntime } from '../runtime/deps.js';
import { runEngineTurn } from '../engine/turn.js';
import type { TurnInput, TurnResult } from '../types.js';
import { packedToInteractive } from '../channel/wa-pack.js';

/**
 * ConverseEngine turn entry — replaces legacy intent→composer spine.
 */
export async function runTurn(
  rt: ConverseRuntime,
  input: TurnInput,
  ctx?: ExecutionContext,
): Promise<TurnResult> {
  const { conversation_id, buyer_text, builder_id, buyer_phone } = input;

  const engine = await rt.engineForTurn();
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
      ...(ctx ? { waitUntil: ctx.waitUntil.bind(ctx) } : {}),
    },
    engine,
  );

  if (result.state.ndConversationId) {
    postTurnEgress(rt, ctx, {
      builder_id: result.state.builderId,
      buyer_phone: result.state.ndBuyerPhone ?? buyer_phone ?? '',
      conversation_id: result.state.ndConversationId,
      buyer_text,
      understood: { intents: [{ kind: result.debug.goal.kind }], slot_writes: [] },
      visitBooked: result.debug.goal.kind === 'visit_booked',
      // The goal's OWN project, not state.focus. Focus moves as the buyer keeps
      // talking, so a booking attributed to focus lands on whichever project
      // happened to be discussed last.
      project_id: result.debug.goal.kind === 'visit_booked'
        ? result.debug.goal.projectId
        : result.state.focus?.projectId,
      // The slot the engine already resolved. visit-slot.ts turns "next
      // saturday 10 baje" into a real IST instant using the conversation's own
      // clock — an anchor that is gone by the time anyone else reads the text.
      // Dropping it here is why 240 leads are marked visit_booked on Desk and
      // only 6 carry a date.
      ...(result.debug.goal.kind === 'visit_booked'
        ? { visit_iso: result.debug.goal.iso, visit_label: result.debug.goal.label }
        : {}),
    });
  }

  const interactive = result.whatsappInteractive
    ? packedToInteractive(result.whatsappInteractive)
    : undefined;

  return {
    reply_text: result.reply,
    composer: result.debug.goal.kind,
    turn_index: result.state.turnCount,
    ...(result.state.ndConversationId ? { nd_conversation_id: result.state.ndConversationId } : {}),
    ...(result.welcome ? { welcome_message: result.welcome } : {}),
    ...(result.consentNotice ? { consent_notice: result.consentNotice } : {}),
    ...(result.whatsappActions ? { whatsapp_actions: result.whatsappActions } : {}),
    ...(interactive ? { whatsapp_interactive: interactive } : {}),
    ...(result.mediaAttachments?.length
      ? {
          media_attachments: result.mediaAttachments.map((a) => ({
            asset_kind: a.asset_kind,
            label: a.label,
            url: a.url,
            delivery: a.delivery,
            ...(a.mime_type ? { mime_type: a.mime_type } : {}),
            ...(a.filename ? { filename: a.filename } : {}),
            ...(a.project_name ? { project_name: a.project_name } : {}),
          })),
        }
      : {}),
    debug: {
      phase: result.debug.phase,
      goal: result.debug.goal,
      ...(result.state.focus
        ? {
            focus: {
              projectId: result.state.focus.projectId,
              projectName: result.state.focus.projectName,
            },
          }
        : {}),
      ...(result.state.constraints ? { constraints: { ...result.state.constraints } } : {}),
      tools: result.debug.tools,
      grounding: result.debug.grounding,
      ...(result.debug.speech_act ? { speech_act: result.debug.speech_act } : {}),
      ...(result.debug.extract_provenance
        ? { extract_provenance: result.debug.extract_provenance }
        : {}),
      ...(result.debug.timings ? { timings: result.debug.timings } : {}),
      ...(result.debug.cache ? { cache: result.debug.cache } : {}),
      ...(result.debug.llm_used != null ? { llm_used: result.debug.llm_used } : {}),
      ...(result.debug.llm_shed ? { llm_shed: true } : {}),
      ...(result.debug.compose_template ? { compose_template: true } : {}),
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
