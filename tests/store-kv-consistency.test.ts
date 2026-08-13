import { describe, expect, it } from 'vitest';
import { kvStore } from '../src/engine/store-kv.js';
import { initState } from '../src/engine/state.js';
import type { ConversationState } from '../src/engine/types.js';

/**
 * KV is a per-colo cache; the Conversation DO is the only store here that is
 * read-after-write consistent. On WhatsApp the two disagree in practice —
 * Meta delivers each webhook from its own egress, so the tap after a project
 * card can be served a snapshot from before that card. These tests fake the
 * disagreement: KV holds the OLD state, the DO holds the new one.
 */
function fakeKv(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    kv: {
      get: async (k: string) => map.get(k) ?? null,
      put: async (k: string, v: string) => void map.set(k, v),
    } as unknown as KVNamespace,
    map,
  };
}

function fakeDo(seed?: ConversationState) {
  let held: ConversationState | null = seed ?? null;
  const ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          held = (JSON.parse(String(init.body)) as { state: ConversationState }).state;
          return new Response('{"ok":true}');
        }
        return new Response(JSON.stringify({ state: held }));
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, read: () => held };
}

function withFocus(convId: string, projectId: string): ConversationState {
  const s = initState(convId, 'brigade-group');
  s.focus = { projectId, projectName: 'Brigade Eldorado' } as ConversationState['focus'];
  return s;
}

describe('conversation state reads', () => {
  it('reads the DO, not a lagging KV copy', async () => {
    const stale = initState('conv:lag', 'brigade-group');
    const { kv } = fakeKv({ 'ce:state:conv:lag': JSON.stringify(stale) });
    const { ns } = fakeDo(withFocus('conv:lag', 'brigade-eldorado'));

    const loaded = await kvStore(kv, ns).load('conv:lag');

    // The founder's live defect: this came back undefined, so the size row he
    // tapped inside Eldorado was read as a book-wide size filter.
    expect(loaded?.focus?.projectId).toBe('brigade-eldorado');
  });

  it('never writes a stale KV snapshot over fresh DO state', async () => {
    const stale = initState('conv:poison', 'brigade-group');
    const { kv } = fakeKv({ 'ce:state:conv:poison': JSON.stringify(stale) });
    const fresh = withFocus('conv:poison', 'brigade-eldorado');
    const doFake = fakeDo(fresh);

    await kvStore(kv, doFake.ns).load('conv:poison');

    // Warming the DO after every KV hit made one stale read stick: the next
    // turn was wrong too, and from the store that had been right.
    expect(doFake.read()?.focus?.projectId).toBe('brigade-eldorado');
  });

  it('falls back to KV when the DO holds nothing, and warms it', async () => {
    const only = withFocus('conv:cold', 'brigade-cornerstone');
    const { kv } = fakeKv({ 'ce:state:conv:cold': JSON.stringify(only) });
    const doFake = fakeDo();

    const loaded = await kvStore(kv, doFake.ns).load('conv:cold');

    expect(loaded?.focus?.projectId).toBe('brigade-cornerstone');
    expect(doFake.read()?.focus?.projectId).toBe('brigade-cornerstone');
  });

  it('has written the DO by the time save resolves', async () => {
    const { kv, map } = fakeKv();
    const doFake = fakeDo();

    await kvStore(kv, doFake.ns).save(withFocus('conv:save', 'brigade-eldorado'));

    // Awaited, not fire-and-forget — the next turn reads the DO first.
    expect(doFake.read()?.focus?.projectId).toBe('brigade-eldorado');
    expect(map.get('ce:state:conv:save')).toContain('brigade-eldorado');
  });
});
