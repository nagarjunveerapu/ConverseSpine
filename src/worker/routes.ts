import type { Env } from '../env.js';
import type { TurnRuntime } from '../runtime/deps.js';
import { runTurn } from '../turn/run-turn.js';
import type { TurnInput, TurnResult } from '../types.js';

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
