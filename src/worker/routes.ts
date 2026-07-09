import type { Env } from '../env.js';
import type { TurnRuntime } from '../runtime/deps.js';
import { runTurn } from '../turn/run-turn.js';
import type { TurnInput, TurnResult } from '../types.js';
import { sendMedia, sendTextWithWamid } from '../channel/whatsapp-client.js';
import { getMetaAccessToken } from '../channel/meta-secrets.js';

export interface ChatRequest {
  builder_id: string;
  buyer_phone: string;
  text: string;
  conversation_id?: string;
  action_id?: string;
}

export interface ChatResponse extends TurnResult {
  conversation_id: string;
}

/**
 * NayaDesk Playground / Auto / Vault expect Naya-shaped /chat JSON:
 * `{ status, reply, conversation_id, debug: { classifier, brain.tool_calls } }`.
 */
export interface DeskChatResponse {
  status: 'ok';
  reply: string;
  reply_text: string;
  conversation_id: string;
  composer: string;
  turn_index: number;
  debug: {
    classifier: { intent: string };
    brain: {
      tool_calls: Array<{ name: string; success: boolean }>;
    };
    phase?: string;
    goal?: unknown;
    tools?: string[];
    grounding?: string;
    speech_act?: string;
  };
  whatsapp_actions?: TurnResult['whatsapp_actions'];
}

/** POST /chat — channel-agnostic ingress (CLI, curl, NayaDesk playground). */
export async function handleChat(
  rt: TurnRuntime,
  body: ChatRequest,
  ctx?: ExecutionContext,
): Promise<ChatResponse> {
  let conversationId = body.conversation_id;
  if (!conversationId) {
    const upsert = await rt.crm.upsertLead({
      builder_id: body.builder_id,
      buyer_phone: body.buyer_phone,
    });
    conversationId = upsert.conversation_id;
  }

  const input: TurnInput = {
    conversation_id: conversationId,
    buyer_text: body.text,
    builder_id: body.builder_id,
    buyer_phone: body.buyer_phone,
    action_id: body.action_id,
  };

  const result = await runTurn(rt, input, ctx);
  return { ...result, conversation_id: conversationId };
}

/** Map Spine turn result → NayaDesk Auto/Vault/Manual contract. */
export function toDeskChatResponse(result: ChatResponse): DeskChatResponse {
  const tools = result.debug?.tools ?? [];
  return {
    status: 'ok',
    reply: result.reply_text,
    reply_text: result.reply_text,
    conversation_id: result.conversation_id,
    composer: result.composer,
    turn_index: result.turn_index,
    debug: {
      classifier: { intent: result.composer },
      brain: {
        tool_calls: tools.map((name) => ({ name, success: true })),
      },
      ...(result.debug?.phase ? { phase: result.debug.phase } : {}),
      ...(result.debug?.goal !== undefined ? { goal: result.debug.goal } : {}),
      ...(tools.length ? { tools } : {}),
      ...(result.debug?.grounding ? { grounding: result.debug.grounding } : {}),
      ...(result.debug?.speech_act ? { speech_act: result.debug.speech_act } : {}),
    },
    ...(result.whatsapp_actions ? { whatsapp_actions: result.whatsapp_actions } : {}),
  };
}

export interface AgentSendBody {
  builder_id: string;
  conversation_id: string;
  buyer_phone: string;
  phone_number_id: string;
  kind?: 'text' | 'document' | 'image' | 'video';
  text?: string;
  link?: string;
  filename?: string;
  caption?: string;
}

/**
 * Human takeover delivery — NayaDesk already logged the message + paused the bot.
 * We deliver via Graph and invalidate TURN_CACHE so the next inbound sees pause.
 */
export async function handleAgentSend(env: Env, body: AgentSendBody): Promise<Response> {
  const { builder_id, conversation_id, buyer_phone, phone_number_id } = body;
  const kind = body.kind ?? 'text';
  if (!builder_id || !buyer_phone || !phone_number_id) {
    return json(
      { error: 'missing_fields', need: ['builder_id', 'buyer_phone', 'phone_number_id'] },
      400,
    );
  }

  let accessToken = getMetaAccessToken(env, builder_id);
  if (!accessToken) {
    try {
      const { NayaDeskClient } = await import('../crm/nayadesk-client.js');
      const creds = await new NayaDeskClient(env).getWhatsAppCreds(builder_id);
      if (creds.access_token) accessToken = creds.access_token;
    } catch {
      /* fall through — delivered=false */
    }
  }

  let wamid: string | null = null;
  if (accessToken) {
    if (kind === 'text') {
      wamid = await sendTextWithWamid(phone_number_id, buyer_phone, body.text ?? '', accessToken);
    } else {
      if (!body.link) return json({ error: 'missing_link_for_media' }, 400);
      wamid = await sendMedia(
        phone_number_id,
        buyer_phone,
        kind,
        body.link,
        { caption: body.caption, filename: body.filename },
        accessToken,
      );
    }
  }

  if (conversation_id && env.TURN_CACHE) {
    try {
      await env.TURN_CACHE.delete(`ctx:${conversation_id}`);
    } catch {
      /* never block on cache */
    }
  }

  return json({ wamid, delivered: !!wamid, has_token: !!accessToken });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function health(env: Env): Response {
  return json({
    status: 'ok',
    service: 'converse-engine',
    version: '0.6.0',
    env: env.LOG_LEVEL ?? 'info',
    nayadesk: env.NAYADESK ? 'binding' : env.NAYADESK_URL ?? 'unset',
    langfuse: Boolean(env.LANGFUSE_PUBLIC_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY),
  });
}
