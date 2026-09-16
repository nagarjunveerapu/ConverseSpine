/**
 * A human took over. The bot must stop talking.
 *
 * Desk has had `bot_paused_at` since the column existed. It stamps it when an
 * agent presses "take over", shows "bot paused" on the lead, counts it in two
 * scorecards and an SLA, and sends the number to this side on every turn.
 *
 * Nothing here ever read it. `NdLead` did not declare the field, so it was
 * dropped at the type boundary — the fifth thread-context field to arrive on
 * every turn and reach nothing. And Meta's webhook points at Spine, not Desk,
 * so Spine is the ONLY thing that can stand the bot down. The agent typed
 * their reply and the bot answered over the top of them, every time.
 *
 * Run against origin/main, every test below fails: `upsertLead` is called only
 * when the caller brings no thread id, its answer is read for `thread_id`
 * alone, and no code path anywhere consults a hold.
 */
import { describe, expect, it, vi } from 'vitest';
import { handleChat, toDeskChatResponse } from '../src/worker/routes.js';
import type { TurnRuntime } from '../src/runtime/deps.js';

/**
 * A runtime whose engine EXPLODES. A held turn must never reach it — so
 * "the engine was not consulted" is an assertion, not an assumption.
 */
function runtime(opts: { bot_paused_at?: number; thread_id?: string } = {}) {
  const appended: Array<{ thread_id: string; direction: string; content: string }> = [];
  const upserts: Array<Record<string, unknown>> = [];
  const engineForTurn = vi.fn(async () => {
    throw new Error('the engine ran on a held turn');
  });
  const rt = {
    crm: {
      upsertLead: async (req: Record<string, unknown>) => {
        upserts.push(req);
        return {
          ok: true as const,
          thread_id: opts.thread_id ?? 'th_upserted',
          created: false,
          // `!== undefined`, not truthiness: a caller asking for a ZERO hold
          // must actually receive `bot_paused_at: 0` on the wire. Omitting it
          // would silently turn the zero case into the absent case and leave
          // "0 means not held" unasserted.
          ...(opts.bot_paused_at !== undefined ? { bot_paused_at: opts.bot_paused_at } : {}),
        };
      },
      appendMessage: async (
        thread_id: string,
        msg: { direction: 'inbound' | 'outbound'; content: string },
      ) => {
        appended.push({ thread_id, ...msg });
        return { ok: true as const, message_id: `m${appended.length}` };
      },
    },
    engineForTurn,
  } as unknown as TurnRuntime;
  return { rt, appended, upserts, engineForTurn };
}

const turn = {
  builder_id: 'brigade-group',
  buyer_phone: '+919200000941',
  text: 'is the 3 BHK still available',
  channel: 'whatsapp' as const,
};

describe('the hold stops the bot', () => {
  it('says nothing at all when a human has taken the buyer over', async () => {
    const { rt, engineForTurn } = runtime({ bot_paused_at: 1789525200000 });

    const result = await handleChat(rt, turn);

    expect(result.reply_text).toBe('');
    expect(result.bot_paused).toBe(true);
    expect(result.composer).toBe('human_hold');
    // Not merely silent — the turn never ran. Composing a reply and dropping
    // it would still burn an LLM call and, worse, advance the thread state
    // under the agent who is mid-conversation.
    expect(engineForTurn).not.toHaveBeenCalled();
  });

  it('still records what the buyer said, because the agent has to read it', async () => {
    const { rt, appended } = runtime({ bot_paused_at: 1789525200000 });

    await handleChat(rt, turn);

    expect(appended).toEqual([
      { thread_id: 'th_upserted', direction: 'inbound', content: 'is the 3 BHK still available' },
    ]);
  });

  it('writes no outbound row — silence must not look like a sent message', async () => {
    const { rt, appended } = runtime({ bot_paused_at: 1789525200000 });

    await handleChat(rt, turn);

    expect(appended.filter((m) => m.direction === 'outbound')).toEqual([]);
  });

  it('treats a zero hold as nobody having taken over', async () => {
    // 0 is what Desk sends for "not held". Reading it as truthy would silence
    // the bot on every thread that has never been taken over — which is all
    // of them.
    const { rt, engineForTurn } = runtime({ bot_paused_at: 0 });

    await expect(handleChat(rt, turn)).rejects.toThrow('the engine ran on a held turn');
    expect(engineForTurn).toHaveBeenCalled();
  });

  it('treats an absent hold as nobody having taken over', async () => {
    // An older Desk sends no field at all. Absent must read as "not held",
    // never as "held" — a deploy-order mistake must not mute the bot.
    const { rt, engineForTurn } = runtime();

    await expect(handleChat(rt, turn)).rejects.toThrow('the engine ran on a held turn');
    expect(engineForTurn).toHaveBeenCalled();
  });

  it('asks Desk on every turn, even when the caller already knows the thread', async () => {
    // The hold is set MID-conversation, so a read that only happens when the
    // caller brings no thread id — or only at session start, where
    // `bootstrapContext` reads — never sees it. This upsert is the one
    // question the turn asks Desk every single time.
    const { rt, upserts, engineForTurn } = runtime({ bot_paused_at: 1789525200000 });

    const result = await handleChat(rt, { ...turn, thread_id: 'th_caller_knows' });

    expect(upserts).toHaveLength(1);
    expect(result.bot_paused).toBe(true);
    expect(engineForTurn).not.toHaveBeenCalled();
  });

  it("keeps the caller's own thread id rather than the one the upsert returned", async () => {
    const { rt, appended } = runtime({ bot_paused_at: 1789525200000, thread_id: 'th_upserted' });

    const result = await handleChat(rt, { ...turn, thread_id: 'th_caller_knows' });

    expect(result.thread_id).toBe('th_caller_knows');
    expect(appended[0]?.thread_id).toBe('th_caller_knows');
  });

  it('tells Desk why the reply is empty, so the playground shows a hold not a blank', async () => {
    const { rt } = runtime({ bot_paused_at: 1789525200000 });

    const desk = toDeskChatResponse(await handleChat(rt, turn));

    expect(desk.bot_paused).toBe(true);
    expect(desk.reply).toBe('');
    // `status` stays 'ok': a held turn is a correct outcome, not a failure,
    // and a caller that retries on non-ok would hammer a silenced thread.
    expect(desk.status).toBe('ok');
  });

  it('says nothing about a hold on an ordinary turn', async () => {
    const desk = toDeskChatResponse({
      reply_text: 'Yes — 3 BHK, 1450 sqft, from ₹1.42 Cr.',
      composer: 'answer',
      turn_index: 4,
      thread_id: 'th_1',
      debug: { phase: 'focused', tools: [], grounding: 'pass', goal: { kind: 'answer' } },
    });

    expect(desk.bot_paused).toBeUndefined();
  });
});
