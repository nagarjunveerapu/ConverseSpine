/**
 * A5 — consent reveal: create/update a Desk lead on the *source* builder
 * (Brigade / Lokations), never under the naya-advisor catalog tenant.
 */
import type { ConverseRuntime } from '../runtime/deps.js';

export interface AdvisorRevealRequest {
  session_id: string;
  /** Advisor-catalog project id (…-naya-advisor) or source project id. */
  project_id: string;
  /** Real WhatsApp number — not the synthetic session phone. */
  buyer_phone: string;
  buyer_name?: string;
  visit_label?: string;
  preferences?: Record<string, string | undefined>;
}

export interface AdvisorRevealResponse {
  status: 'ok' | 'error';
  session_id: string;
  source_builder_id?: string;
  source_project_id?: string;
  project_name?: string;
  conversation_id?: string;
  created?: boolean;
  error?: string;
}

/** Pure — parse Desk bot_hints_json + optional -naya-advisor suffix fallback. */
export function resolveSourceRouting(input: {
  advisorProjectId: string;
  botHintsJson?: string | null;
  projectName?: string;
}): { sourceBuilderId: string; sourceProjectId: string; projectName: string } | { error: string } {
  const id = input.advisorProjectId.trim();
  if (!id) return { error: 'project_id_required' };

  let hints: Record<string, unknown> = {};
  if (input.botHintsJson?.trim()) {
    try {
      hints = JSON.parse(input.botHintsJson) as Record<string, unknown>;
    } catch {
      return { error: 'bot_hints_invalid' };
    }
  }

  const fromHintsBuilder =
    typeof hints.source_builder_id === 'string' ? hints.source_builder_id.trim() : '';
  const fromHintsProject =
    typeof hints.source_project_id === 'string' ? hints.source_project_id.trim() : '';

  const suffix = '-naya-advisor';
  const stripped = id.endsWith(suffix) ? id.slice(0, -suffix.length) : '';

  const sourceProjectId = fromHintsProject || stripped || id;
  const sourceBuilderId = fromHintsBuilder;

  if (!sourceBuilderId) return { error: 'source_builder_missing' };
  if (!sourceProjectId) return { error: 'source_project_missing' };

  return {
    sourceBuilderId,
    sourceProjectId,
    projectName: (input.projectName ?? '').trim() || sourceProjectId,
  };
}

export function normalizeRevealPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

export async function handleAdvisorReveal(
  rt: ConverseRuntime,
  body: AdvisorRevealRequest,
): Promise<AdvisorRevealResponse> {
  const session_id = body.session_id?.trim() ?? '';
  const project_id = body.project_id?.trim() ?? '';
  const phone = normalizeRevealPhone(body.buyer_phone ?? '');
  const buyer_name = body.buyer_name?.trim() ?? '';

  if (!session_id) {
    return { status: 'error', session_id: '', error: 'session_id_required' };
  }
  if (!project_id) {
    return { status: 'error', session_id, error: 'project_id_required' };
  }
  if (!phone) {
    return { status: 'error', session_id, error: 'buyer_phone_invalid' };
  }
  if (!buyer_name) {
    return { status: 'error', session_id, error: 'buyer_name_required' };
  }

  let projectRow: { bot_hints_json?: string; name?: string; project_id?: string };
  try {
    projectRow = (await rt.crm.getProject(project_id)) as {
      bot_hints_json?: string;
      name?: string;
      project_id?: string;
    };
  } catch {
    return { status: 'error', session_id, error: 'project_lookup_failed' };
  }

  const routed = resolveSourceRouting({
    advisorProjectId: project_id,
    botHintsJson: projectRow.bot_hints_json,
    projectName: projectRow.name,
  });
  if ('error' in routed) {
    return { status: 'error', session_id, error: routed.error };
  }

  const prefs = body.preferences ?? {};
  const visit = body.visit_label?.trim() ?? '';

  try {
    const resp = await rt.crm.upsertLead({
      builder_id: routed.sourceBuilderId,
      buyer_phone: phone,
      buyer_name,
      project_id: routed.sourceProjectId,
      channel: 'advisor_web',
      source: 'naya_advisor',
      source_detail: 'advisor_reveal',
      ...(prefs.bhk?.trim() ? { bhk_preference: prefs.bhk.trim() } : {}),
      ...(prefs.budget?.trim() ? { budget_inr: prefs.budget.trim() } : {}),
      ...(prefs.purpose?.trim() ? { purpose: prefs.purpose.trim() } : {}),
      ...(visit || prefs.visit_date_pref?.trim()
        ? { visit_date_pref: visit || prefs.visit_date_pref!.trim() }
        : {}),
    });

    const note = [
      'NayaAdvisor reveal',
      routed.projectName ? `· ${routed.projectName}` : '',
      visit ? `· visit ${visit}` : '',
      `· session ${session_id.slice(0, 12)}`,
    ]
      .filter(Boolean)
      .join(' ');
    await rt.engine.crm
      .appendMessage(resp.conversation_id, 'outbound', note, { kind: 'advisor_reveal' })
      .catch(() => undefined);

    return {
      status: 'ok',
      session_id,
      source_builder_id: routed.sourceBuilderId,
      source_project_id: routed.sourceProjectId,
      project_name: routed.projectName,
      conversation_id: resp.conversation_id,
      created: resp.created,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'error', session_id, error: `lead_upsert_failed:${msg.slice(0, 120)}` };
  }
}
