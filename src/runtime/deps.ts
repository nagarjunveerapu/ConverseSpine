import type { Env } from '../env.js';
import { NayaDeskClient } from '../crm/nayadesk-client.js';
import { makeEngineLlm } from '../engine/adapters/llm.js';
import { makeSemanticNlu } from '../engine/adapters/semantic-nlu.js';
import { nayadeskCrm, nayadeskData } from '../engine/adapters/nayadesk.js';
import { extractTurnFactsBaml, resolveBamlExtractMode } from '../engine/extract-baml.js';
import { runEngineTurn } from '../engine/turn.js';
import { kvStore } from '../engine/store-kv.js';
import type { EngineDeps } from '../engine/ports.js';
import { LangfuseTracer } from '../observability/langfuse.js';
import { emitLocalTurnLog, localTurnLogEnabled } from '../observability/local-turn-log.js';
import { classifyTurnIntent } from '../engine/turn-intent/classify.js';

/** ConverseEngine runtime — wires NayaDesk + KV state + LLM compose. */
export class ConverseRuntime {
  readonly crm: NayaDeskClient;
  readonly trace: LangfuseTracer;
  readonly engine: EngineDeps;

  constructor(readonly env: Env) {
    this.crm = new NayaDeskClient(env);
    this.trace = new LangfuseTracer(env);
    const bamlMode = resolveBamlExtractMode(env);
    this.engine = {
      data: nayadeskData(this.crm),
      llm: makeEngineLlm(env),
      semantic: makeSemanticNlu(env),
      crm: nayadeskCrm(this.crm, { understandingCapture: env.UNDERSTANDING_CAPTURE === 'true' }),
      store: kvStore(env.TURN_CACHE),
      clock: {
        nowMs: () => Date.now(),
        nowIso: () => new Date().toISOString(),
      },
      turnIntent: {
        classify: (input) => classifyTurnIntent(env, input),
      },
      maps: env.GOOGLE_PLACES_API_KEY ? { apiKey: env.GOOGLE_PLACES_API_KEY } : undefined,
      // Forward the WHOLE intent-layer config, not just the bindings. This
      // Pick used to be {AI, INTENT_VECTORS} only, which silently dropped
      // SIL_EMBED_MODEL and SIL_INTENT_PROJECTION on the live turn path: the
      // learned metric applied through /api/sil/probe (full Env) and was inert
      // in the actual bot. Same failure shape as the embed-model drift —
      // narrowing a Pick is a config leak that nothing type-checks against.
      routingEnv:
        env.AI || env.INTENT_VECTORS
          ? {
              AI: env.AI,
              INTENT_VECTORS: env.INTENT_VECTORS,
              SIL_EMBED_MODEL: env.SIL_EMBED_MODEL,
              SIL_INTENT_PROJECTION: env.SIL_INTENT_PROJECTION,
              SIL_ROUTING_TAU: env.SIL_ROUTING_TAU,
              SIL_EMBED_FIRST: env.SIL_EMBED_FIRST,
            }
          : undefined,
      ...(bamlMode !== 'off'
        ? {
            bamlMode,
            bamlExtract: (input) => extractTurnFactsBaml(env, input),
          }
        : {}),
      ...(env.FAILURE_LOG === 'true' ? { failureLog: true } : {}),
      ...(localTurnLogEnabled(env)
        ? { emitTurnLog: (entry) => emitLocalTurnLog(env, entry) }
        : {}),
    };
  }

  defaultBuilderId(): string {
    return this.env.DEFAULT_BUILDER_ID ?? 'lokations';
  }
}

export function createWorkerRuntime(env: Env): ConverseRuntime {
  return new ConverseRuntime(env);
}

/** @deprecated use ConverseRuntime */
export type TurnRuntime = ConverseRuntime;

export { runEngineTurn };
