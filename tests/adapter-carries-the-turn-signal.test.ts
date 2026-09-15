import { describe, it, expect } from 'vitest';
import { nayadeskCrm } from '../src/engine/adapters/nayadesk.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';

/**
 * The last link, and the one that had been cut.
 *
 * `nayadeskCrm().appendMessage` ended in a literal `void meta;` — it took the
 * meta object and threw it away, so nothing the engine decided about a turn
 * ever reached the HTTP body. Not even `replyKey`, which the port had declared
 * since it was written.
 *
 * This asserts on the BODY the client is handed, because that body is what
 * Desk's transcript door reads. A test that stops at the engine port passes
 * with `void meta` back in place — which is how this gap survived: the port
 * was the boundary everything was tested at, and the break was one layer
 * below it.
 */

function clientSpy() {
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    async appendMessage(_threadId: string, msg: Record<string, unknown>) {
      sent.push(msg);
      return { ok: true as const, message_id: 'm1' };
    },
  } as unknown as NayaDeskClient;
  return { sent, crm: nayadeskCrm(client) };
}

describe('the adapter hands Desk what the turn decided', () => {
  it('an outbound turn arrives with its intent, topic and tool history', async () => {
    const { sent, crm } = clientSpy();
    await crm.appendMessage('th_1', 'outbound', 'Here are three that fit.', {
      replyKey: 'recommend',
      intent: 'recommend',
      topic: 'overview',
      toolsInvoked: [{ name: 'search', produced_evidence: true, latency_ms: 12 }],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      direction: 'outbound',
      content: 'Here are three that fit.',
      reply_key: 'recommend',
      classifier_intent: 'recommend',
      classifier_topic: 'overview',
    });
    expect(sent[0]!.tools_invoked).toEqual([
      { name: 'search', produced_evidence: true, latency_ms: 12 },
    ]);
  });

  it('an inbound opt-out arrives spelled the way the DPDP posture counts it', async () => {
    const { sent, crm } = clientSpy();
    await crm.appendMessage('th_1', 'inbound', 'please take me off your list', {
      intent: 'opt_out',
    });

    expect(sent[0]).toMatchObject({ direction: 'inbound', classifier_intent: 'opt_out' });
  });

  it('a turn that classified nothing sends nothing, rather than blanks', async () => {
    // An agent typing in the desk classifies nothing. NULL and '' are
    // different facts and a COUNT can tell them apart, so the absent field
    // must stay absent rather than arrive as an empty string.
    const { sent, crm } = clientSpy();
    await crm.appendMessage('th_1', 'outbound', 'Sure — what budget?');

    expect(sent[0]).toEqual({ direction: 'outbound', content: 'Sure — what budget?' });
    expect('classifier_intent' in sent[0]!).toBe(false);
    expect('tools_invoked' in sent[0]!).toBe(false);
  });

  it('an empty tool list is not sent as a tool run', async () => {
    const { sent, crm } = clientSpy();
    await crm.appendMessage('th_1', 'outbound', 'ok', { replyKey: 'ack', toolsInvoked: [] });

    expect(sent[0]).toMatchObject({ reply_key: 'ack' });
    expect('tools_invoked' in sent[0]!).toBe(false);
  });
});
