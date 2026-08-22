/**
 * A send that reports nothing is a send nobody can audit.
 *
 * On 22 Aug 2026 a buyer received three of the five messages the Desk thread
 * said they had. The two missing ones — the self-registration welcome and the
 * STOP/DELETE consent line — were the only two that travelled through
 * `sendText`, which discarded Graph's status, Graph's body and Graph's
 * exception alike and returned `null` for all three. The interactive senders
 * beside it had logged their refusals since the day they shipped.
 *
 * These tests are differential against that: every one of them fails on the
 * code as it stood, because the code as it stood had no value to assert on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendInteractiveList,
  sendMediaOutcome,
  sendTextOutcome,
} from '../src/channel/whatsapp-client.js';
import { deliverWhatsAppTurn } from '../src/channel/wa-deliver.js';
import { statusDetail, fileStatusReceipts } from '../src/channel/delivery-receipt.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';

const OK = { ok: true, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) };
const REFUSED = {
  ok: false,
  status: 400,
  text: async () =>
    '{"error":{"code":131047,"message":"Re-engagement message","error_data":{"details":"Message failed to send because more than 24 hours have passed."}}}',
};

function bodies(mock: ReturnType<typeof vi.fn>): Array<Record<string, any>> {
  return mock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));
}

describe('what Graph said', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('carries the refusal back instead of swallowing it', async () => {
    fetchMock.mockResolvedValue(REFUSED);
    const out = await sendTextOutcome('pid', '+919000000001', 'hello', 'tok');

    expect(out.ok).toBe(false);
    // The status AND Meta's own words. A code with no sentence is unreadable
    // on a sales desk; a sentence with no code is unsearchable in a log.
    expect(out.error).toContain('400');
    expect(out.error).toContain('131047');
    expect(out.error).toContain('more than 24 hours');
    expect(console.error).toHaveBeenCalled();
  });

  it('treats an accepted message with no wamid as SENT, not as a failure', async () => {
    // `!!wamid` was the old verdict, so this exact response — Graph said yes and
    // did not name the message — aborted the turn.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const out = await sendTextOutcome('pid', '+919000000001', 'hello', 'tok');

    expect(out.ok).toBe(true);
    expect(out.wamid).toBeNull();
  });

  it('says so when the fetch itself throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const out = await sendMediaOutcome('pid', '+91900', 'document', 'https://x/y.pdf', {}, 'tok');

    expect(out.ok).toBe(false);
    expect(out.error).toContain('network down');
  });
});

describe('a turn reports every bubble it was asked to send', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const WELCOME = "Hi Nagarjun — you're through to Brigade Group on WhatsApp.";
  const REPLY = 'Brigade Meadows starts at ₹68L for a 2 BHK.';
  const CONSENT = 'Reply STOP any time to stop messages, or DELETE to remove everything we hold about you.';

  it('files a receipt per bubble, keyed by the exact text Desk recorded', async () => {
    fetchMock.mockResolvedValue(OK);
    const report = await deliverWhatsAppTurn('pid', '+919000000002', {
      reply_text: REPLY,
      welcome_message: WELCOME,
      consent_notice: CONSENT,
    }, 'tok');

    expect(report.parts.map((p) => p.content)).toEqual([WELCOME, REPLY, CONSENT]);
    expect(report.parts.every((p) => p.status === 'sent')).toBe(true);
    expect(report.parts.every((p) => p.wamid === 'wamid.ok')).toBe(true);
  });

  it('reports the consent line as failed, in Meta words, when Meta refuses it', async () => {
    fetchMock.mockResolvedValueOnce(OK).mockResolvedValueOnce(REFUSED);
    const report = await deliverWhatsAppTurn('pid', '+919000000003', {
      reply_text: REPLY,
      consent_notice: CONSENT,
    }, 'tok');

    const consent = report.parts.find((p) => p.content === CONSENT)!;
    expect(consent.status).toBe('failed');
    expect(consent.detail).toContain('131047');
    // The answer still went. One refused bubble must not condemn the turn.
    expect(report.parts.find((p) => p.content === REPLY)!.status).toBe('sent');
  });

  it('folds a refused welcome into the reply rather than losing the greeting', async () => {
    fetchMock.mockResolvedValueOnce(REFUSED).mockResolvedValue(OK);
    const report = await deliverWhatsAppTurn('pid', '+919000000004', {
      reply_text: REPLY,
      welcome_message: WELCOME,
    }, 'tok');

    const sentBodies = bodies(fetchMock);
    // The second attempt carries both, so the buyer learns whose number this is.
    expect(sentBodies[1]!.text.body).toBe(`${WELCOME}\n\n${REPLY}`);
    // And the row for the answer is still filed under the answer alone — the
    // fold is a delivery detail, not a rewrite of what the engine composed.
    expect(report.parts.find((p) => p.content === REPLY)).toBeTruthy();
    expect(report.parts.find((p) => p.content === WELCOME)!.status).toBe('sent');
  });

  it('does not fold when the two together would overflow an interactive body', async () => {
    const LONG = 'x'.repeat(1100);
    fetchMock.mockResolvedValueOnce(REFUSED).mockResolvedValue(OK);
    const report = await deliverWhatsAppTurn('pid', '+919000000005', {
      reply_text: LONG,
      welcome_message: WELCOME,
    }, 'tok');

    expect(bodies(fetchMock)[1]!.text.body).toBe(LONG);
    expect(report.parts.find((p) => p.content === WELCOME)!.status).toBe('failed');
  });

  it('files the ANSWER wamid, not the carrier prompt, when a long body split in two', async () => {
    const LONG = 'y'.repeat(1200);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.answer' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.carrier' }] }) });

    const out = await sendInteractiveList(
      'pid', '+919000000006', LONG, 'Pick one',
      [{ title: 'Costs', rows: [{ id: 'r1', title: '2 BHK' }] }], 'tok',
    );

    // Desk's row holds the long answer. A receipt filed under the carrier's id
    // would attach Meta's later verdict to a bubble nothing recorded.
    expect(out).toEqual({ ok: true, wamid: 'wamid.answer' });
  });
});

describe("Meta's own verdict, which arrives after the send", () => {
  it('reads the specific sentence, not just the category', () => {
    expect(statusDetail({
      errors: [{ code: 131049, title: 'Not delivered', error_data: { details: 'Meta chose not to deliver this message.' } }],
    })).toBe('131049: Meta chose not to deliver this message.');
  });

  it('forwards only the four statuses a row can hold, and logs the failures', async () => {
    const calls: unknown[] = [];
    const crm = { reportWhatsAppDelivery: async (r: unknown) => { calls.push(r); return { ok: true as const, matched: 1 }; } };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await fileStatusReceipts(crm as unknown as NayaDeskClient, 'brigade-group', [
      { id: 'wamid.1', status: 'delivered' },
      { id: 'wamid.2', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] },
      { id: 'wamid.3', status: 'invented_by_meta' },
      { status: 'read' },
    ]);

    const sent = calls[0] as { reports: Array<{ wamid: string; status: string }> };
    expect(sent.reports.map((r) => r.wamid)).toEqual(['wamid.1', 'wamid.2']);
    expect(console.error).toHaveBeenCalled();
  });

  it('files nothing at all when there is nothing a row could learn', async () => {
    const crm = { reportWhatsAppDelivery: vi.fn() };
    await fileStatusReceipts(crm as unknown as NayaDeskClient, 'brigade-group', [{ id: 'w', status: 'nonsense' }]);
    expect(crm.reportWhatsAppDelivery).not.toHaveBeenCalled();
  });
});
