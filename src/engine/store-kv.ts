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

export function kvStore(kv: KVNamespace | undefined): EngineStore {
  const memory = devMemory();
  return {
    async load(convId) {
      if (kv) {
        const raw = await kv.get(`${PREFIX}${convId}`);
        if (raw) return JSON.parse(raw) as ConversationState;
        return null;
      }
      return memory.get(convId) ?? null;
    },
    async save(state) {
      if (kv) {
        await kv.put(`${PREFIX}${state.convId}`, JSON.stringify(state), { expirationTtl: 60 * 60 * 24 * 30 });
        return;
      }
      memory.set(state.convId, state);
    },
    async logTurn(_entry) {
      /* optional — turn ledger via CRM */
    },
  };
}
