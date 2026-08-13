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
 * L0 — Conversation DO (TurnDebouncer) hot state, with KV as the durable copy.
 * DO id = `state:{convId}` so /chat and WhatsApp share the same class.
 *
 * The DO is READ FIRST because it is the only one of the two that is
 * read-after-write consistent. KV is a per-colo cache with up to a minute of
 * lag, and on WhatsApp consecutive turns do not arrive from one place: Meta
 * delivers each webhook from its own egress, so the tap after a project card
 * can land on a colo still holding the PRE-focus snapshot. That is how a size
 * tap inside Brigade Eldorado came back as a book-wide search (13 Aug, live).
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
    /* non-fatal — KV still holds the durable copy */
  }
}

export function kvStore(
  kv: KVNamespace | undefined,
  conversationDo?: DurableObjectNamespace,
): EngineStore {
  const memory = devMemory();
  return {
    async load(convId) {
      const hot = await doStateGet(conversationDo, convId);
      if (hot) return hot;
      if (kv) {
        const raw = await kv.get(`${PREFIX}${convId}`);
        if (raw) {
          const state = JSON.parse(raw) as ConversationState;
          // Warm the DO — but ONLY from a DO miss. Warming it after every KV
          // read is what made a stale read stick: the lagging snapshot was
          // written over the fresh one, so the turn after the bad turn was
          // wrong too, from the good store.
          await doStatePut(conversationDo, state);
          return state;
        }
      } else {
        const mem = memory.get(convId);
        if (mem) return mem;
      }
      return null;
    },
    async save(state) {
      // Awaited: the DO is what the next turn reads. KV is written behind it
      // as the durable 30-day copy (and the only store when no DO is bound).
      await doStatePut(conversationDo, state);
      if (kv) {
        await kv.put(`${PREFIX}${state.convId}`, JSON.stringify(state), {
          expirationTtl: 60 * 60 * 24 * 30,
        });
      } else {
        memory.set(state.convId, state);
      }
    },
    async logTurn(_entry) {
      /* optional — turn ledger via CRM */
    },
  };
}
