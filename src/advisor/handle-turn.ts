/**
 * NayaAdvisor channel ingress — ConverseEngine + NayaDesk.
 * Replaces Naya naya-agent for web advisor turns.
 */
import type { ConverseRuntime } from '../runtime/deps.js';
import { runEngineTurn } from '../engine/turn.js';
import { prefetchProjects } from '../engine/project-cache.js';
import { commitTo, initState, markAsked, withNdConversation } from '../engine/state.js';
import { detectSoftPrefs } from '../engine/facts.js';
import { derivedPriorityFromWorries } from '../engine/advisor-weights.js';
import { mapAdvisorTurnResponse } from './map-response.js';
import {
  advisorPrefsDelta,
  advisorPrefsSnapshot,
  ingressFilledSlotsFromPreferences,
  mergeAdvisorPreferences,
  preferenceClearsFromPatch,
} from './apply-preferences.js';
import { isFocusedSearchPivot } from '../engine/turn-intent/focused-intent.js';
import { isVisitFollowUpQuestion, isVisitRouteExpand } from '../engine/phases/visit.js';
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
  let ingressFilledSlots: import('../engine/ingress.js').IngressSlotKey[] | undefined;

  const projectId = body.project_id?.trim();
  const projectName = body.project_name?.trim();
  const pivotTurn = isFocusedSearchPivot(text);

  if (body.preferences && Object.keys(body.preferences).length > 0) {
    let existing = (await rt.engine.store.load(convId)) ?? initState(convId, builder_id);
    if (!existing.ndConversationId && buyer_phone) {
      const lead = await rt.engine.crm.ensureLead(builder_id, buyer_phone, 'advisor_web').catch(() => null);
      if (lead) existing = withNdConversation(existing, lead.conversationId, buyer_phone);
    }
    const inRecovery =
      existing.rti?.lastUiMode === 'search_recovery' ||
      existing.rti?.lastUiMode === 'preference_refine' ||
      existing.rti?.lastGoalKind === 'no_fit';
    // Field-level delta-merge (RTI-2.1, reworked): out of recovery the whole
    // brief applies — the advisor UI is source of truth. In recovery only
    // fields whose value CHANGED vs the last-applied snapshot apply, so a
    // stale re-sent brief can't clobber recovery edits, but a fresh buyer
    // edit mid-recovery is never swallowed wholesale again.
    const effectivePrefs = inRecovery
      ? advisorPrefsDelta(existing.advisorPrefsSnapshot, body.preferences)
      : body.preferences;
    if (Object.keys(effectivePrefs).length > 0) {
      preferenceClears = preferenceClearsFromPatch(effectivePrefs);
      ingressFilledSlots = ingressFilledSlotsFromPreferences(effectivePrefs);
      existing = {
        ...existing,
        constraints: mergeAdvisorPreferences(existing.constraints, effectivePrefs),
        discover: { ...existing.discover, oriented: true },
        advisorPrefsSnapshot: advisorPrefsSnapshot(body.preferences, existing.advisorPrefsSnapshot),
      };
      await rt.engine.store.save(existing);
    }
    if (!inRecovery) {

      // Trade-off Advisor: one-time priority ask, exactly between brief-merge
      // and the first shortlist. Advisor-door pre-turn (same class as the
      // preference merge above — no engine stage added). The buyer's chip
      // answer next turn is parsed at L3 (detectSoftPrefs → priorityFocus)
      // and drives the Desk preference re-rank. Asked at most once ever
      // (markAsked); ignored answers simply proceed unweighted.
      const narrowing = Boolean(
        existing.constraints.budgetMaxInr ||
        existing.constraints.bhk ||
        existing.constraints.location ||
        existing.constraints.propertyType,
      );
      // Worries can settle commute-vs-budget on their own — then don't ask.
      // So does an explicit commute decline: with commute off the table the
      // question has no tension left — asking it anyway is the "didn't
      // listen" defect. Of the two tradables, budget rules by elimination.
      if (!existing.constraints.priorityFocus) {
        const derived = derivedPriorityFromWorries(existing.constraints)
          ?? (existing.constraints.commuteDeclined ? 'budget' : undefined);
        if (derived) {
          existing = {
            ...existing,
            constraints: { ...existing.constraints, priorityFocus: derived },
          };
          await rt.engine.store.save(existing);
        }
      }
      if (
        narrowing &&
        !existing.constraints.priorityFocus &&
        !existing.discover.asked.includes('priority') &&
        existing.discover.lastOffered.length === 0 &&
        !projectId &&
        !body.action_id?.trim()
      ) {
        // Keep soft signals the intercepted text carried ("we work at ITPL").
        const soft = detectSoftPrefs(text);
        let askedState = markAsked(existing, 'priority');
        if (Object.keys(soft).length > 0) {
          askedState = { ...askedState, constraints: { ...askedState.constraints, ...soft } };
        }
        await rt.engine.store.save(askedState);
        return {
          status: 'ok',
          session_id,
          reply:
            'One quick thing so I rank these right — does a shorter commute matter more, or staying on budget?',
          conversation_id: convId,
          ...(askedState.ndConversationId ? { nd_conversation_id: askedState.ndConversationId } : {}),
          phase: askedState.phase,
          // matches_hub moves the SPA out of brief_collect so nba.chips render
          // (brief_collect keeps the brief wizard's own chips in the tray).
          ui_mode: 'matches_hub',
          nba: { chips: ['Shorter commute', 'Staying on budget', 'About equal'], board: 'none' },
        };
      }
    }
  }

  if (projectId && !pivotTurn && !isVisitRouteExpand(text)) {
    let existing = (await rt.engine.store.load(convId)) ?? initState(convId, builder_id);
    if (!existing.ndConversationId && buyer_phone) {
      const lead = await rt.engine.crm.ensureLead(builder_id, buyer_phone, 'advisor_web').catch(() => null);
      if (lead) existing = withNdConversation(existing, lead.conversationId, buyer_phone);
    }
    const skipStickyFocus =
      existing.phase === 'visit' ||
      isVisitFollowUpQuestion(text) ||
      (isVisitRouteExpand(text) && existing.visit?.projectId);
    if (!skipStickyFocus && existing.focus?.projectId !== projectId) {
      const name =
        projectName ||
        existing.discover.lastOffered.find((p) => p.projectId === projectId)?.name ||
        projectId;
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
        ingressFilledSlots,
        briefExtract: body.brief_extract === true,
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
