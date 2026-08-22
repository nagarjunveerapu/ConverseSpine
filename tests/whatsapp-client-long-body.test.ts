/**
 * An interactive body is capped at 1024. We used to slice to fit, which kept the
 * buttons and ate the end of the answer mid-sentence — a two-project comparison
 * on the live Brigade book runs ~1350 chars. The answer now goes out whole as
 * text and the chrome rides on a short follow-up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendInteractiveButtons, sendInteractiveList } from '../src/channel/whatsapp-client.js';

interface SentMessage {
  type: string;
  text?: { body: string };
  interactive?: { body: { text: string } };
}

function sent(mock: ReturnType<typeof vi.fn>): SentMessage[] {
  return mock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as SentMessage);
}

const LONG = `*Brigade Eldorado* vs *Brigade Cornerstone Utopia*. ${'Both are large township formats with their own clubhouse, and the trade-off is price against possession. '.repeat(
  12,
)}`;

describe('whatsapp interactive — bodies over the 1024 limit', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends a long answer whole as text, then the buttons on a short follow-up', async () => {
    expect(LONG.length).toBeGreaterThan(1024);
    const ok = await sendInteractiveButtons('pid', '+919000000001', LONG, [{ id: 'a', title: 'Price' }], 'tok');

    expect(ok.ok).toBe(true);
    const messages = sent(fetchMock);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.type).toBe('text');
    expect(messages[0]!.text!.body).toBe(LONG);
    expect(messages[1]!.type).toBe('interactive');
    expect(messages[1]!.interactive!.body.text.length).toBeLessThanOrEqual(1024);
  });

  it('does the same for a list, and never truncates the answer', async () => {
    const ok = await sendInteractiveList(
      'pid',
      '+919000000002',
      LONG,
      'Pick one',
      [{ title: 'Costs', rows: [{ id: 'r1', title: '2 BHK' }] }],
      'tok',
    );

    expect(ok.ok).toBe(true);
    const messages = sent(fetchMock);
    expect(messages[0]!.text!.body).toBe(LONG);
    expect(messages.some((m) => m.interactive?.body.text === LONG.slice(0, 1024))).toBe(false);
  });

  it('keeps a short body on the interactive itself — one bubble, as before', async () => {
    const ok = await sendInteractiveButtons('pid', '+919000000003', 'Want the price?', [{ id: 'a', title: 'Price' }], 'tok');

    expect(ok.ok).toBe(true);
    const messages = sent(fetchMock);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.interactive!.body.text).toBe('Want the price?');
  });

  it('still counts the turn delivered when the long text landed but the chrome was refused', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) })
      .mockResolvedValueOnce({ ok: false, text: async () => 'bad interactive' });

    const ok = await sendInteractiveButtons('pid', '+919000000004', LONG, [{ id: 'a', title: 'Price' }], 'tok');

    expect(ok.ok).toBe(true);
    // The answer went out once — a fallback resend would double-send it.
    expect(sent(fetchMock).filter((m) => m.text?.body === LONG)).toHaveLength(1);
  });
});
