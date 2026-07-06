import { prefetchProjects } from '../engine/project-cache.js';
import { commitTo, initState, withNdConversation } from '../engine/state.js';
import type { ConverseRuntime } from '../runtime/deps.js';
import { mapProjectDetailDto, type AdvisorProjectDetailDto } from './map-project-detail.js';
import { sessionToConvId, sessionToPhone } from './session.js';

const DEFAULT_ADVISOR_BUILDER = 'naya-advisor';

export type AdvisorProjectDetailResponse =
  | { status: 'ok'; project: AdvisorProjectDetailDto; live: true }
  | { status: 'error'; error: string };

export async function handleAdvisorProjectDetail(
  rt: ConverseRuntime,
  params: { session_id: string; project_id: string; buyer_phone?: string; builder_id?: string },
): Promise<AdvisorProjectDetailResponse> {
  const session_id = params.session_id?.trim() ?? '';
  const project_id = params.project_id?.trim() ?? '';
  const builder_id =
    params.builder_id?.trim() ||
    rt.env.ADVISOR_BUILDER_ID?.trim() ||
    rt.env.DEFAULT_BUILDER_ID?.trim() ||
    DEFAULT_ADVISOR_BUILDER;
  const buyer_phone = params.buyer_phone?.trim() || (session_id ? sessionToPhone(session_id) : '');

  if (!session_id) return { status: 'error', error: 'session_id_required' };
  if (!project_id) return { status: 'error', error: 'project_id_required' };

  const convId = sessionToConvId(session_id);
  let state = (await rt.engine.store.load(convId)) ?? initState(convId, builder_id);

  if (!state.ndConversationId && buyer_phone) {
    const lead = await rt.engine.crm.ensureLead(builder_id, buyer_phone).catch(() => null);
    if (lead) state = withNdConversation(state, lead.conversationId, buyer_phone);
  }

  const nd = state.ndConversationId;
  if (!nd) return { status: 'error', error: 'lead_unavailable' };

  const projectName =
    state.discover.lastOffered.find((p) => p.projectId === project_id)?.name ??
    state.focus?.projectName ??
    project_id;

  if (state.focus?.projectId !== project_id) {
    await rt.engine.crm.commitProject(nd, project_id).catch(() => {});
    state = commitTo(state, project_id, projectName);
  }

  state = await prefetchProjects(rt.engine, state, [project_id]);
  await rt.engine.store.save(state);

  const detail = state.projectCache?.[project_id];
  if (!detail) return { status: 'error', error: 'project_unavailable' };

  return { status: 'ok', project: mapProjectDetailDto(detail), live: true };
}
