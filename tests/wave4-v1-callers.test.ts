import { afterEach, describe, expect, it, vi } from 'vitest';
import { NayaDeskClient } from '../src/crm/nayadesk-client.js';

/**
 * Wave 4: leftover colliding writers hit /api/v1 (Desk Wave 3 doors), not
 * leftover /api. Desk DROP+RENAME is not mergeable while these still POST
 * leftover messages/facts/search/share.
 */
function stubJson(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Wave 4 Spine posts leftover colliding doors on /api/v1', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const crm = () => new NayaDeskClient({ nayadeskUrl: 'https://desk.test', botSecret: 's' });

  it('upsertLead PUTs /api/v1/leads', async () => {
    const fetchMock = stubJson({ ok: true, thread_id: 'c1', created: true });
    await crm().upsertLead({ builder_id: 'sandbox', buyer_phone: '+919000000901' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/leads');
  });

  it('getLead GETs /api/v1/leads/:id', async () => {
    const fetchMock = stubJson({ lead: { lead_id: 'ld_1', thread_id: 'c1', builder_id: 'sandbox', buyer_phone: '+91' } });
    await crm().getLead('c1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/leads/c1');
  });

  it('patchFacts PATCHes /api/v1/leads/:id/facts', async () => {
    const fetchMock = stubJson({ ok: true });
    await crm().patchFacts('c1', { purpose: 'self_use' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/leads/c1/facts');
  });

  it('searchProjects POSTs /api/v1/projects/search', async () => {
    const fetchMock = stubJson({ matches: [] });
    await crm().searchProjects({ builder_id: 'sandbox', search_text: 'Ayana' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/projects/search');
  });

  it('mediaShare POSTs /api/v1/media/share', async () => {
    const fetchMock = stubJson({ allowed: true });
    await crm().mediaShare({ project_id: 'p1', thread_id: 'c1', asset_kind: 'brochure' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/media/share');
  });

  it('appendMessage POSTs /api/v1/threads/:id/messages and maps the row to ok+id', async () => {
    const fetchMock = stubJson({ message_id: 'msg_1' }, 201);
    const r = await crm().appendMessage('c1', { direction: 'inbound', content: 'hi' });
    expect(r).toEqual({ ok: true, message_id: 'msg_1' });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/threads/c1/messages',
    );
  });

  it('listMessages GETs /api/v1/threads/:id/messages', async () => {
    const fetchMock = stubJson({ messages: [] });
    await crm().listMessages('c1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/threads/c1/messages?limit=50',
    );
  });

  it('getProject GETs /api/v1/projects/:id', async () => {
    const fetchMock = stubJson({ project: { project_id: 'p1', builder_id: 'sandbox', name: 'Ayana' } });
    await crm().getProject('p1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/projects/p1');
  });

  it('projectEtag GETs /api/v1/projects/:id/etag and maps updated_at', async () => {
    const fetchMock = stubJson({ etag: 'e1', updated_at: 9 });
    const r = await crm().projectEtag('p1');
    expect(r).toEqual({ etag: 'e1', latest_updated_at: 9 });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/projects/p1/etag');
  });

  it('faqLookup GETs /api/v1/faqs/lookup', async () => {
    const fetchMock = stubJson({ faq: null });
    await crm().faqLookup('p1', 'rera');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/faqs/lookup?project_id=p1&question_key=rera',
    );
  });

  it('listProjectMedia GETs /api/v1/media after the project for builder_id', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const body = String(url).includes('/projects/')
        ? { project: { project_id: 'p1', builder_id: 'sandbox', name: 'Ayana' } }
        : { media: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await crm().listProjectMedia('p1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://desk.test/api/v1/projects/p1');
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(
      'https://desk.test/api/v1/media?project_id=p1&builder_id=sandbox',
    );
  });

  it('threadContext POSTs /api/thread-context', async () => {
    const fetchMock = stubJson({ lead: {}, recent_messages: [] });
    await crm().threadContext('c1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/thread-context',
    );
  });

  it('commitProject POSTs /api/threads/:id/commit-project', async () => {
    const fetchMock = stubJson({ ok: true, thread_id: 'c1', project_id: 'p1', project_state: 'focused' });
    await crm().commitProject('c1', 'p1');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/threads/c1/commit-project',
    );
  });

  it('reportWhatsAppDelivery still POSTs leftover /api/whatsapp/delivery', async () => {
    const fetchMock = stubJson({ ok: true, matched: 1 });
    await crm().reportWhatsAppDelivery({
      builder_id: 'sandbox',
      thread_id: 'c1',
      reports: [{ content: 'hi', wamid: 'wamid.1', status: 'sent' }],
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/whatsapp/delivery',
    );
  });

  it('patchStage maps visit_booked → visiting on /api/v1/leads/:id/stage', async () => {
    const fetchMock = stubJson({ stage: 'visiting' });
    await crm().patchStage('c1', 'visit_booked');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/leads/c1/stage',
    );
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({
      stage: 'visiting',
    });
  });

  it('patchStage escalated POSTs /api/v1/leads/:id/escalate', async () => {
    const fetchMock = stubJson({ escalated_at: 1 });
    await crm().patchStage('c1', 'escalated');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/leads/c1/escalate',
    );
  });

  it('applyStateWrites POSTs /api/v1/leads/:id/state-writes', async () => {
    const fetchMock = stubJson({ ok: true, applied: 1 });
    await crm().applyStateWrites('c1', [{ op: 'set_slot', slot: 'bhk', value: '2' }]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/leads/c1/state-writes',
    );
  });

  it('proposeVisit POSTs /api/v1/leads/:id/visits', async () => {
    const fetchMock = stubJson({ visit_id: 'visit_1' }, 201);
    await crm().proposeVisit('c1', {
      scheduled_at: '2026-08-29 11:00',
      project_id: 'p1',
      status: 'confirmed',
    });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://desk.test/api/v1/leads/c1/visits',
    );
  });
});
