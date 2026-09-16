import type { NayaDeskClient } from '../crm/nayadesk-client.js';

/**
 * Where an inbound number lands: which builder, and — for a PROJECT LINE —
 * which project. The front desk resolves with `project_id: null`.
 *
 * A builder has one front desk (the number on its own row) and, since Desk
 * 0244, any number of project lines. A message on a project line is a message
 * about that project: the pursuit it opens is born there, not on whichever
 * project the ladder guesses.
 */
export interface LineHit {
  builder_id: string;
  project_id: string | null;
}

let cache: { at: number; map: Map<string, LineHit> } | null = null;
const TTL_MS = 60_000;
/**
 * Floor between refreshes a MISS triggers, so a number that belongs to nobody
 * — a placeholder, a stray probe — cannot turn every inbound message into a
 * round trip to Desk.
 */
const MISS_REFRESH_FLOOR_MS = 5_000;

async function refresh(crm: NayaDeskClient): Promise<Map<string, LineHit>> {
  const { builders, lines } = await crm.listBuilders();
  const map = new Map<string, LineHit>();
  // The front desks first, off the number each builder row names...
  for (const b of builders) {
    if (b.meta_phone_number_id) {
      map.set(b.meta_phone_number_id, { builder_id: b.builder_id, project_id: null });
    }
  }
  // ...then every project line. A Desk that predates lines sends none, and
  // the map is exactly what it was before lines existed.
  for (const l of lines ?? []) {
    if (l.phone_number_id) {
      map.set(l.phone_number_id, { builder_id: l.builder_id, project_id: l.project_id ?? null });
    }
  }
  cache = { at: Date.now(), map };
  return map;
}

/**
 * Resolve Meta phone_number_id → the line it is (builder + project) via the
 * NayaDesk builders list (bot scope).
 *
 * A miss refreshes the map before giving up. Without that, the minute after a
 * tenant is connected is a black hole: the map was built before they existed,
 * the TTL has not expired, so the lookup misses — and the caller drops the
 * message with `if (!line) continue`, silently, returning 200 so Meta
 * records it as delivered. The operator who was told to text the number to
 * verify the connection sees exactly the failure the connection checks exist
 * to rule out, and it heals on its own a minute later, which reads as
 * flakiness rather than as a cache.
 *
 * A hit costs nothing extra. Only a miss pays, and only once per floor.
 *
 * A failure to reach Desk still throws rather than resolving to null: the
 * caller turns null into a silent drop, but an exception surfaces as a 5xx,
 * and a 5xx is the one answer that makes Meta retry the delivery.
 */
export async function resolveLineByPhoneNumberId(
  crm: NayaDeskClient,
  phoneNumberId: string,
): Promise<LineHit | null> {
  const now = Date.now();
  const map = !cache || now - cache.at > TTL_MS ? await refresh(crm) : cache.map;

  const hit = map.get(phoneNumberId);
  if (hit) return hit;

  // `cache` is non-null here — both branches above set it. A refresh that just
  // ran leaves `at` at ~now, so this cannot double-fetch.
  if (cache && Date.now() - cache.at > MISS_REFRESH_FLOOR_MS) {
    return (await refresh(crm)).get(phoneNumberId) ?? null;
  }
  return null;
}

/** The builder alone, for callers that only need the tenant (the secret lookup). */
export async function resolveBuilderByPhoneNumberId(
  crm: NayaDeskClient,
  phoneNumberId: string,
): Promise<string | null> {
  return (await resolveLineByPhoneNumberId(crm, phoneNumberId))?.builder_id ?? null;
}

/** Drop the memoised map. Tests only — isolates share module state otherwise. */
export function __resetPhoneResolveCache(): void {
  cache = null;
}
