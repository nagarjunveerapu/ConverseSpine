import type { NayaDeskClient } from '../crm/nayadesk-client.js';

interface BuilderRow {
  builder_id: string;
  meta_phone_number_id: string;
}

let cache: { at: number; map: Map<string, string> } | null = null;
const TTL_MS = 60_000;

/** Resolve Meta phone_number_id → builder_id via NayaDesk builders list (bot scope). */
export async function resolveBuilderByPhoneNumberId(
  crm: NayaDeskClient,
  phoneNumberId: string,
): Promise<string | null> {
  const now = Date.now();
  if (!cache || now - cache.at > TTL_MS) {
    const { builders } = await crm.listBuilders();
    const map = new Map<string, string>();
    for (const b of builders) {
      if (b.meta_phone_number_id) map.set(b.meta_phone_number_id, b.builder_id);
    }
    cache = { at: now, map };
  }
  return cache.map.get(phoneNumberId) ?? null;
}
