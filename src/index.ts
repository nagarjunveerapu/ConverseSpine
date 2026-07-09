import type { Env } from './env.js';
import { handleAdvisorBriefFacets } from './advisor/handle-brief-facets.js';
import { handleAdvisorProjectDetail } from './advisor/handle-project-detail.js';
import { handleAdvisorTurn } from './advisor/handle-turn.js';
import { createWorkerRuntime } from './runtime/deps.js';
import { handleAgentSend, handleChat, health, json, toDeskChatResponse } from './worker/routes.js';
import { handleVerify } from './webhook/verify.js';
import { handleWhatsAppWebhook } from './webhook/whatsapp.js';

export { TurnDebouncer } from './agent/turn_debouncer.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === '/health' && method === 'GET') {
        return health(env);
      }

      // Human takeover from NayaDesk lead dossier (Graph send + TURN_CACHE invalidate).
      if (path === '/internal/agent-send' && method === 'POST') {
        const secret = request.headers.get('x-bot-secret');
        if (env.BOT_SHARED_SECRET && secret !== env.BOT_SHARED_SECRET) {
          return json({ error: 'forbidden' }, 403);
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }
        return handleAgentSend(env, body as Parameters<typeof handleAgentSend>[1]);
      }

      if (path === '/webhook' && method === 'GET') {
        return handleVerify(request, env);
      }

      if (path === '/webhook' && method === 'POST') {
        return handleWhatsAppWebhook(request, env, ctx);
      }

      if (path === '/api/advisor/brief-facets' && method === 'GET') {
        const builderId = url.searchParams.get('builder_id') ?? 'naya-advisor';
        const rt = createWorkerRuntime(env);
        const result = await handleAdvisorBriefFacets(rt, builderId);
        const status = result.status === 'error' && result.error === 'builder_id_required' ? 400 : 200;
        return json(result, status);
      }

      if (path === '/api/advisor/project' && method === 'GET') {
        const rt = createWorkerRuntime(env);
        const result = await handleAdvisorProjectDetail(rt, {
          session_id: url.searchParams.get('session_id') ?? '',
          project_id: url.searchParams.get('project_id') ?? '',
          buyer_phone: url.searchParams.get('buyer_phone') ?? undefined,
          builder_id: url.searchParams.get('builder_id') ?? undefined,
        });
        const status =
          result.status === 'error' &&
          (result.error === 'session_id_required' || result.error === 'project_id_required')
            ? 400
            : result.status === 'error'
              ? 404
              : 200;
        return json(result, status);
      }

      if (path === '/api/advisor/turn' && method === 'POST') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ status: 'error', error: 'invalid_json' }, 400);
        }

        const rt = createWorkerRuntime(env);
        const result = await handleAdvisorTurn(rt, body as Parameters<typeof handleAdvisorTurn>[1]);
        const status =
          result.status === 'error' &&
          (result.error === 'text_required' || result.error === 'session_id_required')
            ? 400
            : 200;
        return json(result, status);
      }

      if (path === '/chat' && method === 'POST') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }

        const parsed = body as {
          builder_id?: string;
          buyer_phone?: string;
          text?: string;
          conversation_id?: string;
        };

        if (!parsed.builder_id || !parsed.buyer_phone || !parsed.text) {
          return json({ error: 'validation', required: ['builder_id', 'buyer_phone', 'text'] }, 400);
        }

        const rt = createWorkerRuntime(env);
        const result = await handleChat(
          rt,
          {
            builder_id: parsed.builder_id,
            buyer_phone: parsed.buyer_phone,
            text: parsed.text,
            conversation_id: parsed.conversation_id,
          },
          ctx,
        );
        // Desk-shaped envelope so Playground / Auto / Vault keep working.
        return json(toDeskChatResponse(result));
      }

      return json({ error: 'not_found', path }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: 'internal', detail: msg.slice(0, 500) }, 500);
    }
  },
};
