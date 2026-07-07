import type { Env } from '../env.js';
import { NayaDeskClient } from '../crm/nayadesk-client.js';
import { makeEngineLlm } from '../engine/adapters/llm.js';
import { makeSemanticNlu } from '../engine/adapters/semantic-nlu.js';
import { nayadeskCrm, nayadeskData } from '../engine/adapters/nayadesk.js';
import { runEngineTurn } from '../engine/turn.js';
import { kvStore } from '../engine/store-kv.js';
import type { EngineDeps } from '../engine/ports.js';
import { LangfuseTracer } from '../observability/langfuse.js';
import { classifyTurnIntent } from '../engine/turn-intent/classify.js';

/** ConverseEngine runtime — wires NayaDesk + KV state + LLM compose. */
export class ConverseRuntime {
  readonly crm: NayaDeskClient;
  readonly trace: LangfuseTracer;
  readonly engine: EngineDeps;

  constructor(readonly env: Env) {
    this.crm = new NayaDeskClient(env);
    this.trace = new LangfuseTracer(env);
    this.engine = {
      data: nayadeskData(this.crm),
      llm: makeEngineLlm(env),
      semantic: makeSemanticNlu(env),
      crm: nayadeskCrm(this.crm),
      store: kvStore(env.TURN_CACHE),
      clock: {
        nowMs: () => Date.now(),
        nowIso: () => new Date().toISOString(),
      },
      turnIntent: {
        classify: (input) => classifyTurnIntent(env, input),
      },
      maps: env.GOOGLE_PLACES_API_KEY ? { apiKey: env.GOOGLE_PLACES_API_KEY } : undefined,
      routingEnv: env.AI || env.INTENT_VECTORS ? { AI: env.AI, INTENT_VECTORS: env.INTENT_VECTORS } : undefined,
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
