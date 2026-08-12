import type { ConversationState } from './types.js';
import type { EngineStore } from './ports.js';

const PREFIX = 'ce:state:';
const DEV_MEMORY_KEY = '__ce_dev_state__';

function devMemory(): Map<string, ConversationState> {
  const g = globalThis as typeof globalThis & {
    [DEV_MEMORY_KEY]?: Map<string, ConversationState>;
  };
  if (!g[DEV_MEMORY_KEY]) g[DEV_MEMORY_KEY] = new Map();
  return g[DEV_MEMORY_KEY];
}

/**
 * L0 — Conversation DO (TurnDebouncer) hot state, with KV durable fallback.
 * DO id = `state:{convId}` so /chat and WhatsApp share the same class.
 *
 * Sync path prefers KV (one RTT). DO is dual-written on save and warmed async
 * after KV hit so WhatsApp isolates get L0 without blocking /chat.
 */
async function doStateGet(
  ns: DurableObjectNamespace | undefined,
  convId: string,
): Promise<ConversationState | null> {
  if (!ns || !convId) return null;
  try {
    const stub = ns.get(ns.idFromName(`state:${convId}`));
    const res = await stub.fetch('https://conversation-do/state', { method: 'GET' });
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: ConversationState | null };
    return body.state ?? null;
  } catch {
    return null;
  }
}

async function doStatePut(
  ns: DurableObjectNamespace | undefined,
  state: ConversationState,
): Promise<void> {
  if (!ns) return;
  try {
    const stub = ns.get(ns.idFromName(`state:${state.convId}`));
    await stub.fetch('https://conversation-do/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  } catch {
    /* non-fatal — KV remains source of truth */
  }
}

export function kvStore(
  kv: KVNamespace | undefined,
  conversationDo?: DurableObjectNamespace,
): EngineStore {
  const memory = devMemory();
  return {
    async load(convId) {
      if (kv) {
        const raw = await kv.get(`${PREFIX}${convId}`);
        if (raw) {
          const state = JSON.parse(raw) as ConversationState;
          // Warm DO off the critical path.
          void doStatePut(conversationDo, state);
          return state;
        }
      } else {
        const mem = memory.get(convId);
        if (mem) return mem;
      }
      // KV miss — try DO (WhatsApp isolate may have L0 only).
      const hot = await doStateGet(conversationDo, convId);
      if (hot) return hot;
      return null;
    },
    async save(state) {
      if (kv) {
        await kv.put(`${PREFIX}${state.convId}`, JSON.stringify(state), {
          expirationTtl: 60 * 60 * 24 * 30,
        });
      } else {
        memory.set(state.convId, state);
      }
      void doStatePut(conversationDo, state);
    },
    async logTurn(_entry) {
      /* optional — turn ledger via CRM */
    },
  };
}
