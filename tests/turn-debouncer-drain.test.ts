import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnDebouncer } from '../src/agent/turn_debouncer.js';
import type { Env } from '../src/env.js';

/**
 * The inbox used to be emptied as the alarm's first act, before the creds
 * fetch, before the engine, before delivery. Anything that threw in between
 * destroyed the buyer's message, and the runtime's alarm retries then all
 * re-entered at `if (inbox.length === 0) return`. The buyer got permanent
 * silence and nothing logged their number.
 *
 * These tests hold the two properties that fix depends on: the batch survives
 * a failure so a retry can answer it, and a message that lands mid-turn is not
 * swept up by the drain that follows.
 *
 * Run against origin/main, the three "keeps the message when X throws" cases
 * fail and the rest pass — those three are the differential. The two mid-turn
 * cases pass on both, deliberately: they guard the *naive* version of this fix,
 * where the drain moves to the bottom but still writes `[]`. That variant loses
 * every message a buyer sends while their previous one is being answered, which
 * is far commoner than the failure being fixed here.
 */

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

interface InboxEntry {
  text: string;
  meta_message_id: string;
}

function fakeState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    storage: {
      // Real DO storage serializes on put and deserializes on get, so a caller
      // never holds a reference the next writer can mutate underneath it.
      // Handing back the live object instead makes an aliasing bug look like
      // correct code — which is exactly what it did while this was written.
      get: async <T>(k: string) => {
        const v = store.get(k);
        return (v === undefined ? undefined : structuredClone(v)) as T | undefined;
      },
      put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
      getAlarm: async () => alarm,
      setAlarm: async (t: number) => void (alarm = t),
    },
    _store: store,
    _alarm: () => alarm,
  } as unknown as DurableObjectState & {
    _store: Map<string, unknown>;
    _alarm: () => number | null;
  };
}

function enqueue(dob: TurnDebouncer, wamid: string, text: string): Promise<Response> {
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

function inboxOf(state: { _store: Map<string, unknown> }): InboxEntry[] {
  return (state._store.get('inbox') as InboxEntry[]) ?? [];
}

describe('TurnDebouncer drain', () => {
  beforeEach(() => {
    handleChat.mockReset();
    deliverWhatsAppTurn.mockReset();
    sendTyping.mockReset();
    getWhatsAppCreds.mockReset();
    getWhatsAppCreds.mockResolvedValue({ access_token: 'tok' });
    handleChat.mockResolvedValue({ reply: 'ok' });
    deliverWhatsAppTurn.mockResolvedValue(undefined);
  });

  it('empties the inbox once the reply is out', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', '2 BHK');

    await dob.alarm();

    expect(deliverWhatsAppTurn).toHaveBeenCalledOnce();
    expect(inboxOf(state)).toEqual([]);
  });

  it('keeps the message when the engine throws, so the retry still has it', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', '2 BHK in whitefield');

    handleChat.mockRejectedValueOnce(new Error('engine blew up'));
    await expect(dob.alarm()).rejects.toThrow('engine blew up');

    // The buyer's words are still there. Before the fix this was [], and the
    // alarm's retries returned at the length check without doing anything.
    expect(inboxOf(state).map((e) => e.text)).toEqual(['2 BHK in whitefield']);

    // The retry the runtime would schedule now answers it.
    await dob.alarm();
    expect(handleChat).toHaveBeenCalledTimes(2);
    expect(deliverWhatsAppTurn).toHaveBeenCalledOnce();
    expect(inboxOf(state)).toEqual([]);
  });

  it('keeps the message when delivery throws', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', 'what is the price');

    deliverWhatsAppTurn.mockRejectedValueOnce(new Error('meta 500'));
    await expect(dob.alarm()).rejects.toThrow('meta 500');

    expect(inboxOf(state).map((e) => e.text)).toEqual(['what is the price']);
  });

  it('keeps the message when the creds fetch throws', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', 'send me the brochure');

    getWhatsAppCreds.mockRejectedValueOnce(new Error('desk 502'));
    await expect(dob.alarm()).rejects.toThrow('desk 502');

    expect(handleChat).not.toHaveBeenCalled();
    expect(inboxOf(state).map((e) => e.text)).toEqual(['send me the brochure']);
  });

  it('does not eat a message that arrives while the turn is running', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', '2 BHK');

    // The buyer keeps typing mid-turn. This is the ordinary case, not an edge
    // one — draining with `[]` at the end instead of slicing would lose it.
    handleChat.mockImplementationOnce(async () => {
      await enqueue(dob, 'wamid.B', 'in whitefield');
      return { reply: 'ok' };
    });

    await dob.alarm();

    expect(inboxOf(state).map((e) => e.text)).toEqual(['in whitefield']);
    // And it has an alarm of its own to be answered on.
    expect(state._alarm()).not.toBeNull();
  });

  it('answers the straggler on the next alarm rather than stranding it', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);
    await enqueue(dob, 'wamid.A', '2 BHK');

    handleChat.mockImplementationOnce(async () => {
      await enqueue(dob, 'wamid.B', 'in whitefield');
      return { reply: 'ok' };
    });

    await dob.alarm();
    await dob.alarm();

    expect(handleChat).toHaveBeenCalledTimes(2);
    expect(handleChat.mock.calls[1]?.[1]).toMatchObject({ text: 'in whitefield' });
    expect(inboxOf(state)).toEqual([]);
  });
});
