/**
 * A held turn must not be DELIVERED either.
 *
 * `handleChat` returning an empty reply is only half the fix. Both WhatsApp
 * delivery paths — the debouncer (what production actually runs) and the
 * webhook's direct fallback — took the turn result and posted it to Meta
 * without asking whether there was anything to say. Handing them a blank
 * reply just moves the bug: the agent who took over still gets stepped on,
 * now with an empty bubble.
 *
 * The drain is asserted separately and deliberately: the buyer's messages WERE
 * handled — they are on the transcript — so leaving them queued would replay
 * every one of them the moment the agent hands the thread back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.js';

const handleChat = vi.fn();
const deliverWhatsAppTurn = vi.fn();
const sendTyping = vi.fn();
const getWhatsAppCreds = vi.fn();

vi.mock('../src/worker/routes.js', () => ({
  handleChat: (...args: unknown[]) => handleChat(...args),
}));
vi.mock('../src/channel/wa-deliver.js', () => ({
  deliverWhatsAppTurn: (...args: unknown[]) => deliverWhatsAppTurn(...args),
}));
vi.mock('../src/channel/whatsapp-client.js', () => ({
  sendTyping: (...args: unknown[]) => sendTyping(...args),
}));
vi.mock('../src/runtime/deps.js', () => ({
  createWorkerRuntime: () => ({ crm: { getWhatsAppCreds: () => getWhatsAppCreds() } }),
}));

const { TurnDebouncer } = await import('../src/agent/turn_debouncer.js');

function fakeState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    storage: {
      get: async (k: string) => structuredClone(store.get(k)),
      put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
      getAlarm: async () => alarm,
      setAlarm: async (t: number) => void (alarm = t),
    },
    _store: store,
  } as unknown as DurableObjectState & { _store: Map<string, unknown> };
}

function enqueue(dob: InstanceType<typeof TurnDebouncer>, wamid: string, text: string) {
  return dob.fetch(
    new Request('https://debouncer/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        builder_id: 'brigade-group',
        buyer_phone: '+919900000001',
        phone_number_id: 'pn1',
        text,
        meta_message_id: wamid,
      }),
    }),
  );
}

describe('a held turn is never delivered', () => {
  beforeEach(() => {
    handleChat.mockReset();
    deliverWhatsAppTurn.mockReset();
    sendTyping.mockReset();
    getWhatsAppCreds.mockReset();
    getWhatsAppCreds.mockResolvedValue({ access_token: 'tok' });
    // `fileTurnReceipts` reads `report.parts`, so the control case needs a
    // real report shape or it fails for a reason that has nothing to do with
    // the hold.
    deliverWhatsAppTurn.mockResolvedValue({ parts: [] });
  });

  it('sends nothing to Meta when a human has taken the buyer over', async () => {
    handleChat.mockResolvedValue({ reply_text: '', bot_paused: true, nd_thread_id: 'th_1' });
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', 'is it still available');

    await dob.alarm();

    expect(deliverWhatsAppTurn).not.toHaveBeenCalled();
  });

  it('still drains the inbox, so nothing is replayed at hand-back', async () => {
    handleChat.mockResolvedValue({ reply_text: '', bot_paused: true, nd_thread_id: 'th_1' });
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', 'is it still available');

    await dob.alarm();

    expect(state._store.get('inbox')).toEqual([]);
  });

  it('delivers normally when nobody has taken over', async () => {
    handleChat.mockResolvedValue({ reply_text: 'Yes — two left.', nd_thread_id: 'th_1' });
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', 'is it still available');

    await dob.alarm();

    expect(deliverWhatsAppTurn).toHaveBeenCalledOnce();
  });
});
