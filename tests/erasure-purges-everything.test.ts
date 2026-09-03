import { describe, expect, it } from 'vitest';
import { kvStore } from '../src/engine/store-kv.js';
import { initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import {
  composeErasureReply,
  performErasure,
  rowsTouched,
} from '../src/engine/erasure-reply.js';
import type { ErasureReceipt } from '../src/engine/ports.js';

/**
 * Erasure, from Spine's side.
 *
 * Desk owns the database sweep and the tombstone. Spine owns three things Desk
 * cannot reach — the site visits, the live chat state, and the sentence
 * the buyer actually reads — and got all three wrong:
 *
 *   - the delete-confirm door cancelled no visits at all,
 *   - `freshSession()` wrote a blank state OVER the record instead of removing
 *     it, and carried the Desk id and the phone number forward while doing it,
 *   - both doors printed a fixed sentence that no run had ever made true.
 */

/** A Durable Object namespace that records what was asked of which instance. */
function fakeDo() {
  const seen: Array<{ name: string; method: string }> = [];
  const stored = new Map<string, unknown>();
  const ns = {
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => ({
      fetch: async (_url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        seen.push({ name: id.name, method });
        if (method === 'DELETE') {
          stored.delete(id.name);
          return new Response(JSON.stringify({ ok: true, purged: true }));
        }
        if (method === 'PUT') {
          stored.set(id.name, JSON.parse(init?.body ?? '{}').state);
          return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify({ state: stored.get(id.name) ?? null }));
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, seen, stored };
}

function fakeKv() {
  const map = new Map<string, string>();
  const kv = {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
    delete: async (k: string) => { map.delete(k); },
  } as unknown as KVNamespace;
  return { kv, map };
}

describe('purge removes the state, it does not overwrite it', () => {
  it('clears the DO, the KV key and the WhatsApp inbox instance', async () => {
    const { ns, seen, stored } = fakeDo();
    const { kv, map } = fakeKv();
    const store = kvStore(kv, ns);

    const s = initState('conv-purge-1', 'lokations');
    s.turnCount = 3;
    await store.save(s);
    expect(map.has('ce:state:conv-purge-1'), 'KV should hold the durable copy').toBe(true);
    expect(stored.has('state:conv-purge-1')).toBe(true);

    await store.purge!('conv-purge-1', { builderId: 'lokations', buyerPhone: '+919999999931' });

    expect(await store.load('conv-purge-1')).toBeNull();
    expect(map.has('ce:state:conv-purge-1'), 'the KV copy would have lived 30 more days').toBe(false);

    // Two addresses, one class. `state:{threadId}` holds L0; the debouncer's
    // `{builderId}:{phone}` instance holds the buyer's phone number, their
    // WhatsApp number id and the raw text of messages not yet processed.
    // Deleting one and not the other leaves the buyer in the other.
    const deleted = seen.filter((c) => c.method === 'DELETE').map((c) => c.name);
    expect(deleted).toContain('state:conv-purge-1');
    expect(deleted).toContain('lokations:+919999999931');
  });

  it('is safe with no phone — a web session has no debouncer instance', async () => {
    const { ns, seen } = fakeDo();
    const { kv } = fakeKv();
    const store = kvStore(kv, ns);
    await store.save(initState('conv-purge-2', 'naya-advisor'));
    await store.purge!('conv-purge-2', { builderId: 'naya-advisor', buyerPhone: '' });
    const deleted = seen.filter((c) => c.method === 'DELETE').map((c) => c.name);
    expect(deleted).toEqual(['state:conv-purge-2']);
  });
});

describe('both doors do the same work', () => {
  const harness = (threadId: string) => {
    const deps = fakeDeps();
    const turn = (text: string) =>
      runEngineTurn(
        { threadId, builderId: 'lokations', text, buyerPhone: '+919999999932', channel: 'whatsapp' },
        deps,
      );
    return { deps, turn };
  };

  it('the typed "delete my data" door cancels visits too', async () => {
    // This is the door that did the LEAST while asking the buyer to confirm.
    // It cleared one table, left the visit booked, and said everything was
    // removed — so the next message could read the buyer their own slot back.
    const { deps, turn } = harness('erase-door-confirm');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('book a visit');
    await turn('saturday morning');
    await turn('yes');

    await turn('delete my data');
    const done = await turn('yes');

    expect(deps.crm.calls).toContain('erase:all');
    expect(done.debug.tools?.join(' ')).toMatch(/cancelSiteVisits:[1-9]/);
    expect(done.reply).toMatch(/site visit is cancelled/i);
    expect(done.state.focus, 'the session outlived the delete').toBeUndefined();
  });

  it('writes nothing back into the chat it just erased', async () => {
    // Both doors used to append the buyer's message AND the reply to Desk
    // after the sweep. `messages` is on the erasure manifest, so those two
    // rows are the buyer's own words landing back in a table we had emptied
    // one call earlier. Desk refuses them now (410); Spine stops sending them.
    const { deps, turn } = harness('erase-no-writeback');
    await turn('coorg, 50 Lakhs');
    const before = deps.crm.calls.filter((c) => c.startsWith('msg:')).length;
    // DELETE, not STOP. STOP is contact-only now and RETAINS the record, so it
    // writes both sides of the exchange down on purpose — see
    // tests/stop-and-delete.test.ts. Only the door that empties the table is
    // forbidden from writing to it afterwards.
    await turn('DELETE');
    const after = deps.crm.calls.filter((c) => c.startsWith('msg:')).length;
    expect(after, 'a message row was written after the erase').toBe(before);
  });
});

describe('the sentence tracks the run', () => {
  const base: ErasureReceipt = {
    scope: 'all',
    deleted: { messages: 12, buyer_memory: 1 },
    redacted: { threads: 1 },
    retained: { bookings: 'a signed agreement is kept by law' },
    retained_counts: {},
    failed: [],
    lead_ids: ['ld-1'],
    thread_ids: ['nd-1'],
    unteach_phrasing_ids: [],
    tombstone_written: true,
    erased_at: 1_700_000_000_000,
  };

  it('counts what was touched', () => {
    expect(rowsTouched(base)).toBe(14);
  });

  it('hands a partial run to a person instead of claiming it finished', () => {
    const partial = { ...base, failed: ['buyer_journey'] };
    const reply = composeErasureReply(partial, { scope: 'all' });
    expect(reply).toMatch(/needs a person to finish/i);
    expect(reply).not.toMatch(/^Done/);
  });

  it('says the same thing when Desk never answered at all', () => {
    // No receipt is not "it worked". The DPDP row stays in_progress on Desk's
    // side for exactly this case, so a human closes it out.
    const reply = composeErasureReply(null, { scope: 'all' });
    expect(reply).toMatch(/needs a person to finish/i);
    expect(reply).toMatch(/stopped all messages/i);
  });

  it('marks a failed purge in the trace so a replay can see it', async () => {
    const deps = fakeDeps();
    const run = await performErasure(
      { crm: deps.crm, data: deps.data, store: { ...deps.store, purge: undefined } },
      {
        threadId: 'trace-1',
        builderId: 'lokations',
        ndThreadId: 'nd-1',
        buyerPhone: '+919999999933',
        scope: 'all',
      },
    );
    expect(run.purged).toBe(false);
    expect(run.tools).toContain('NO_PURGE');
  });
});
