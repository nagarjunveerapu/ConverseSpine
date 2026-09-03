import type { ThreadState } from './types.js';
import type { EngineStore } from './ports.js';

const PREFIX = 'ce:state:';
const DEV_MEMORY_KEY = '__ce_dev_state__';

function devMemory(): Map<string, ThreadState> {
  const g = globalThis as typeof globalThis & {
    [DEV_MEMORY_KEY]?: Map<string, ThreadState>;
  };
  if (!g[DEV_MEMORY_KEY]) g[DEV_MEMORY_KEY] = new Map();
  return g[DEV_MEMORY_KEY];
}

/**
 * L0 — Thread DO (TurnDebouncer) hot state, with KV as the durable copy.
 * DO id = `state:{threadId}` so /chat and WhatsApp share the same class.
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
  threadId: string,
): Promise<ThreadState | null> {
  if (!ns || !threadId) return null;
  try {
    const stub = ns.get(ns.idFromName(`state:${threadId}`));
    const res = await stub.fetch('https://thread-do/state', { method: 'GET' });
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: ThreadState | null };
    return body.state ?? null;
  } catch {
    return null;
  }
}

async function doStatePut(
  ns: DurableObjectNamespace | undefined,
  state: ThreadState,
): Promise<void> {
  if (!ns) return;
  try {
    const stub = ns.get(ns.idFromName(`state:${state.threadId}`));
    await stub.fetch('https://thread-do/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  } catch {
    /* non-fatal — KV still holds the durable copy */
  }
}

async function doStateDelete(
  ns: DurableObjectNamespace | undefined,
  name: string,
): Promise<void> {
  if (!ns || !name) return;
  try {
    const stub = ns.get(ns.idFromName(name));
    await stub.fetch('https://thread-do/state', { method: 'DELETE' });
  } catch {
    /* non-fatal — see purge() */
  }
}

export function kvStore(
  kv: KVNamespace | undefined,
  threadStateDo?: DurableObjectNamespace,
): EngineStore {
  const memory = devMemory();
  return {
    async load(threadId) {
      const hot = await doStateGet(threadStateDo, threadId);
      if (hot) return hot;
      if (kv) {
        const raw = await kv.get(`${PREFIX}${threadId}`);
        if (raw) {
          const state = JSON.parse(raw) as ThreadState;
          // Warm the DO — but ONLY from a DO miss. Warming it after every KV
          // read is what made a stale read stick: the lagging snapshot was
          // written over the fresh one, so the turn after the bad turn was
          // wrong too, from the good store.
          await doStatePut(threadStateDo, state);
          return state;
        }
      } else {
        const mem = memory.get(threadId);
        if (mem) return mem;
      }
      return null;
    },
    async save(state) {
      // Awaited: the DO is what the next turn reads. KV is written behind it
      // as the durable 30-day copy (and the only store when no DO is bound).
      await doStatePut(threadStateDo, state);
      if (kv) {
        await kv.put(`${PREFIX}${state.threadId}`, JSON.stringify(state), {
          expirationTtl: 60 * 60 * 24 * 30,
        });
      } else {
        memory.set(state.threadId, state);
      }
    },
    /**
     * Erasure. Both DO addresses and the KV key, because the buyer is in all
     * three: `state:{threadId}` holds l0_state, `{builderId}:{buyerPhone}` holds
     * their phone number and their raw unsent messages, and KV holds the
     * 30-day durable copy.
     *
     * Best-effort per store and never throws — a purge failure must not take
     * down the turn that is telling the buyer they have been erased. Desk's
     * tombstone is the authority either way, so a surviving Spine snapshot
     * cannot write anything back: state-writes returns 410 on an erased shell.
     */
    async purge(threadId, buyerKey) {
      await doStateDelete(threadStateDo, `state:${threadId}`);
      if (buyerKey?.builderId && buyerKey.buyerPhone) {
        await doStateDelete(threadStateDo, `${buyerKey.builderId}:${buyerKey.buyerPhone}`);
      }
      if (kv) {
        await kv.delete(`${PREFIX}${threadId}`).catch(() => {});
      } else {
        memory.delete(threadId);
      }
    },
    async logTurn(_entry) {
      /* optional — turn ledger via CRM */
    },
  };
}
