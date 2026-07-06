/**
 * NayaAdvisor channel ingress — ConverseEngine + NayaDesk.
 * Replaces Naya naya-agent for web advisor turns.
 */
import type { ConverseRuntime } from '../runtime/deps.js';
import { runEngineTurn } from '../engine/turn.js';
import { prefetchProjects } from '../engine/project-cache.js';
import { commitTo, initState, withNdConversation } from '../engine/state.js';
import { mapAdvisorTurnResponse } from './map-response.js';
import { mergeAdvisorPreferences, preferenceClearsFromPatch } from './apply-preferences.js';
import { isFocusedSearchPivot } from '../engine/turn-intent/focused-intent.js';
import type { AdvisorTurnRequest, AdvisorTurnResponse } from './types.js';
import { sessionToConvId, sessionToPhone } from './session.js';

const DEFAULT_ADVISOR_BUILDER = 'naya-advisor';

export async function handleAdvisorTurn(
  rt: ConverseRuntime,
  body: AdvisorTurnRequest,
): Promise<AdvisorTurnResponse> {
  const session_id = body.session_id?.trim() ?? '';
  const text = (body.text ?? body.message ?? '').trim();
  const builder_id =
    body.builder_id?.trim() ||
    rt.env.ADVISOR_BUILDER_ID?.trim() ||
    rt.env.DEFAULT_BUILDER_ID?.trim() ||
    DEFAULT_ADVISOR_BUILDER;
  const buyer_phone = body.buyer_phone?.trim() || (session_id ? sessionToPhone(session_id) : '');

  if (!session_id) {
    return { status: 'error', session_id: '', reply: '', conversation_id: '', error: 'session_id_required' };
  }
  if (!text) {
    return {
      status: 'error',
      session_id,
      reply: '',
      conversation_id: sessionToConvId(session_id),
      error: 'text_required',
    };
  }

  const convId = body.conversation_id?.trim() || sessionToConvId(session_id);

  let preferenceClears: import('../engine/turn-intent/types.js').PatchClearKey[] | undefined;

  const projectId = body.project_id?.trim();
  const projectName = body.project_name?.trim();
  const pivotTurn = isFocusedSearchPivot(text);

  if (body.preferences && Object.keys(body.preferences).length > 0) {
    preferenceClears = preferenceClearsFromPatch(body.preferences);
    let existing = (await rt.engine.store.load(convId)) ?? initState(convId, builder_id);
    if (!existing.ndConversationId && buyer_phone) {
      const lead = await rt.engine.crm.ensureLead(builder_id, buyer_phone).catch(() => null);
      if (lead) existing = withNdConversation(existing, lead.conversationId, buyer_phone);
    }
    const inRecovery =
      existing.rti?.lastUiMode === 'search_recovery' ||
      existing.rti?.lastUiMode === 'preference_refine' ||
      existing.rti?.lastGoalKind === 'no_fit';
    if (!inRecovery) {
      existing = {
        ...existing,
        constraints: mergeAdvisorPreferences(existing.constraints, body.preferences),
        discover: { ...existing.discover, oriented: true },
      };
      await rt.engine.store.save(existing);
    }
  }

  if (projectId && !pivotTurn) {
    let existing = (await rt.engine.store.load(convId)) ?? initState(convId, builder_id);
    if (!existing.ndConversationId && buyer_phone) {
      const lead = await rt.engine.crm.ensureLead(builder_id, buyer_phone).catch(() => null);
      if (lead) existing = withNdConversation(existing, lead.conversationId, buyer_phone);
    }
    const name =
      projectName ||
      existing.discover.lastOffered.find((p) => p.projectId === projectId)?.name ||
      projectId;
    if (existing.focus?.projectId !== projectId) {
      if (existing.ndConversationId) {
        await rt.engine.crm.commitProject(existing.ndConversationId, projectId).catch(() => {});
      }
      existing = commitTo(existing, projectId, name);
      existing = await prefetchProjects(rt.engine, existing, [projectId]);
      await rt.engine.store.save(existing);
    }
  }

  try {
    const result = await runEngineTurn(
      {
        convId,
        builderId: builder_id,
        text,
        buyerPhone: buyer_phone,
        channel: 'advisor_web',
        action_id: body.action_id?.trim(),
        preferenceClears,
      },
      rt.engine,
    );

    return mapAdvisorTurnResponse({
      sessionId: session_id,
      state: result.state,
      reply: result.reply,
      debug: result.debug,
      compareMatrix: result.compareMatrix,
      searchRecovery: result.searchRecovery,
      uiMode: result.uiMode,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      session_id,
      reply: '',
      conversation_id: convId,
      error: msg.slice(0, 300),
    };
  }
}
