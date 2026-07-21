import type { Env } from './env.js';
import { handleAdvisorBriefFacets } from './advisor/handle-brief-facets.js';
import { handleAdvisorProjectDetail } from './advisor/handle-project-detail.js';
import { handleAdvisorTurn } from './advisor/handle-turn.js';
import { createWorkerRuntime } from './runtime/deps.js';
import { handleAgentSend, handleChat, health, json, toDeskChatResponse } from './worker/routes.js';
import { overRateLimit } from './channel/ingress-guard.js';
import { handleVerify } from './webhook/verify.js';
import { handleWhatsAppWebhook } from './webhook/whatsapp.js';
import { rebuildIntentIndex } from './rebuild/intent-index.js';
import { runAutoTeach } from './understanding/auto-teach.js';

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
      // Hard first-human-touch for Desk SLA is stamped on Desk BEFORE this call:
      // messages.policy_action='agent_manual' + activity_log action='agent_manual_send'.
      // Spine delivers WA + invalidates cache; it does not own the CRM hard-event clock.
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
          channel?: 'whatsapp' | 'advisor_web' | 'api';
        };

        if (!parsed.builder_id || !parsed.buyer_phone || !parsed.text) {
          return json({ error: 'validation', required: ['builder_id', 'buyer_phone', 'text'] }, 400);
        }

        // W6 — /chat is unauthenticated buyer-shaped ingress: rate-limit it
        // per buyer. Trusted callers (Desk playground over the service
        // binding, eval harness) carry x-bot-secret and are exempt — staff
        // and CI must never be throttled.
        const botSecret = request.headers.get('x-bot-secret');
        const trusted = !!botSecret && !!env.BOT_SHARED_SECRET && botSecret === env.BOT_SHARED_SECRET;
        if (!trusted && (await overRateLimit(env.TURN_CACHE, `${parsed.builder_id}:${parsed.buyer_phone}`, Date.now()))) {
          return json({ error: 'rate_limited', retry_after_s: 300 }, 429);
        }

        const rt = createWorkerRuntime(env);
        const result = await handleChat(
          rt,
          {
            builder_id: parsed.builder_id,
            buyer_phone: parsed.buyer_phone,
            text: parsed.text,
            conversation_id: parsed.conversation_id,
            // W6 — label the door; bare /chat callers are 'api'.
            channel: parsed.channel ?? 'api',
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

  /**
   * Cron Triggers.
   *  - Weekly (Mon 03:30 UTC): SIL rebuild — keeps the intent index in sync with
   *    the git registry (+ Desk-promoted rows in canonical mode). Incremental.
   *  - Nightly (22:30 UTC = 04:00 IST): Wave C auto-teach — teacher-confident
   *    clusters pass the exact holdout no-regression gate, safe ones promote as
   *    'flywheel_auto' and ship via an incremental rebuild. Runs AFTER Desk's
   *    18:00 UTC sweep+teacher so tonight's verdicts are in. No-op unless
   *    UNDERSTANDING_AUTO_TEACH=true.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '30 22 * * *') {
      ctx.waitUntil(
        (async () => {
          const report = await runAutoTeach(env);
          console.log('[understanding-auto-teach]', JSON.stringify(report));
        })(),
      );
      return;
    }
    ctx.waitUntil(
      (async () => {
        const report = await rebuildIntentIndex(env);
        console.log('[sil-intent-rebuild]', JSON.stringify(report));
      })(),
    );
  },
};
