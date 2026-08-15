import type { Env } from '../env.js';
import { NayaDeskClient } from '../crm/nayadesk-client.js';
import { meterAi, newEmbedMeter } from '../cache/embed-meter.js';
import { makeEngineLlm } from '../engine/adapters/llm.js';
import { makeSemanticNlu } from '../engine/adapters/semantic-nlu.js';
import { nayadeskCrm, nayadeskData } from '../engine/adapters/nayadesk.js';
import { extractTurnFactsBaml, resolveBamlExtractMode } from '../engine/extract-baml.js';
import { llmRateTarget, resolveHybridMode } from '../engine/hybrid.js';
import {
  recoverIntentWithEnv,
  resolveIntentRecoveryMode,
} from '../engine/intent-recovery.js';
import { runEngineTurn } from '../engine/turn.js';
import { kvStore } from '../engine/store-kv.js';
import type { EngineDeps } from '../engine/ports.js';
import { LangfuseTracer } from '../observability/langfuse.js';
import { emitLocalTurnLog, localTurnLogEnabled } from '../observability/local-turn-log.js';
import { classifyTurnIntent } from '../engine/turn-intent/classify.js';
import { engineDepsWithRuntimeFlags } from './failure-flags.js';
import { resolveWaProjectFirst } from '../channel/wa-pack.js';

function resolveSyncBamlMode(env: Env): import('../engine/extract-baml.js').BamlExtractMode {
  const hybrid = resolveHybridMode(env);
  const sync = (env.SYNC_BAML_MODE ?? '').trim().toLowerCase();
  if (sync === 'off' || sync === 'shadow' || sync === 'promote') {
    return sync;
  }
  // Hybrid default: shadow BAML (train signal, no slot override). Floor→shadow.
  if (hybrid === 'on' && (sync === '' || sync === 'floor')) {
    return 'shadow';
  }
  return resolveBamlExtractMode(env);
}

/** ConverseEngine runtime — wires NayaDesk + KV state + LLM compose. */
export class ConverseRuntime {
  readonly crm: NayaDeskClient;
  readonly trace: LangfuseTracer;
  readonly engine: EngineDeps;

  constructor(readonly env: Env) {
    this.crm = new NayaDeskClient(env);
    this.trace = new LangfuseTracer(env);
    const bamlMode = resolveSyncBamlMode(env);
    const intentRecoveryMode = resolveIntentRecoveryMode(env);
    const hybridMode = resolveHybridMode(env);
    const cacheStats: import('../cache/turn-cache.js').CacheStats = {};
    this.engine = {
      data: nayadeskData(this.crm, {
        AI: env.AI,
        EDUCATION_VECTORS: env.EDUCATION_VECTORS,
        SIL_EMBED_MODEL: env.SIL_EMBED_MODEL,
        TURN_CACHE: env.TURN_CACHE,
        cacheStats,
      }),
      llm: makeEngineLlm(env),
      semantic: makeSemanticNlu(env),
      crm: nayadeskCrm(this.crm, { understandingCapture: env.UNDERSTANDING_CAPTURE === 'true' }),
      store: kvStore(env.TURN_CACHE, env.TURN_DEBOUNCER),
      turnCache: env.TURN_CACHE,
      projectEtag: (projectId) =>
        this.crm.projectEtag(projectId).catch(() => null),
      cacheStats,
      projectCardMemo: new Map(),
      clock: {
        nowMs: () => Date.now(),
        nowIso: () => new Date().toISOString(),
      },
      turnIntent: {
        classify: (input) => classifyTurnIntent(env, input),
      },
      hybridMode,
      ...(hybridMode === 'on' ? { llmRateTarget: llmRateTarget(env) } : {}),
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
              FAILURE_ROUTING: env.FAILURE_ROUTING,
              TURN_CACHE: env.TURN_CACHE,
              // debug bag — classify may stamp emb hit/miss
              ...(cacheStats ? { cacheStats } : {}),
            }
          : undefined,
      ...(bamlMode !== 'off'
        ? {
            bamlMode,
            bamlExtract: (input) => extractTurnFactsBaml(env, input),
          }
        : {}),
      ...(intentRecoveryMode !== 'off'
        ? {
            intentRecoveryMode,
            intentRecover: (input) => recoverIntentWithEnv(env, input),
          }
        : {}),
      ...(env.FAILURE_LOG === 'true' ? { failureLog: true } : {}),
      ...(env.FAILURE_TOOLS === 'true' ? { failureTools: true } : {}),
      ...(env.FAILURE_ROUTING === 'true' ? { failureRouting: true } : {}),
      ...(env.FAILURE_SEARCH === 'true' ? { failureSearch: true } : {}),
      ...(env.FAILURE_ANSWER === 'true' ? { failureAnswer: true } : {}),
      ...(env.ROUTING_IN_GOAL === 'true' ? { routingInGoal: true } : {}),
      ...(env.UNDERSTANDING_BEFORE_MUTATION === 'true'
        ? { understandingBeforeMutation: true }
        : {}),
      ...(env.VISIT_EMBED_ACTS_ONLY === 'true' ? { visitEmbedActsOnly: true } : {}),
      ...(env.TOPIC_UNION === 'true' ? { topicUnion: true } : {}),
      waProjectFirst: resolveWaProjectFirst(
        env.WA_PROJECT_FIRST,
        (env.NAYADESK_URL ?? '').includes('nayadesk-prod'),
      ),
      ...(localTurnLogEnabled(env)
        ? { emitTurnLog: (entry) => emitLocalTurnLog(env, entry) }
        : {}),
    };
  }

  defaultBuilderId(): string {
    return this.env.DEFAULT_BUILDER_ID ?? 'lokations';
  }

  /** Per-turn deps with KV force-off overlay for Failure flags (kill without redeploy). */
  async engineForTurn(): Promise<EngineDeps> {
    const base = await engineDepsWithRuntimeFlags(this.env, this.engine);
    // Fresh memo + stats every turn — warm isolates reuse ConverseRuntime and a
    // shared projectCardMemo was cross-chat poisoning L2 hit/miss + thinning
    // overview when a stub card lingered from another conversation.
    const cacheStats: import('../cache/turn-cache.js').CacheStats = {};
    // Same reasoning as cacheStats: fresh every turn, because a warm isolate
    // reuses ConverseRuntime and a shared counter would report the isolate's
    // lifetime instead of this buyer's turn. `semantic` is rebuilt here rather
    // than reused from `base` for the same reason — makeSemanticNlu closes over
    // the env it was handed, so the constructor-time one holds the raw binding.
    const embedMeter = newEmbedMeter();
    const AI = this.env.AI ? meterAi(this.env.AI, embedMeter) : this.env.AI;
    return {
      ...base,
      cacheStats,
      embedMeter,
      projectCardMemo: new Map(),
      semantic: makeSemanticNlu({ ...this.env, AI }),
      data: nayadeskData(this.crm, {
        AI,
        EDUCATION_VECTORS: this.env.EDUCATION_VECTORS,
        SIL_EMBED_MODEL: this.env.SIL_EMBED_MODEL,
        TURN_CACHE: this.env.TURN_CACHE,
        cacheStats,
      }),
      ...(base.routingEnv
        ? { routingEnv: { ...base.routingEnv, AI, cacheStats } }
        : {}),
    };
  }
}

export function createWorkerRuntime(env: Env): ConverseRuntime {
  return new ConverseRuntime(env);
}

/** @deprecated use ConverseRuntime */
export type TurnRuntime = ConverseRuntime;

export { runEngineTurn };
