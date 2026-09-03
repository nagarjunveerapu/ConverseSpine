import { afterEach, describe, expect, it, vi } from 'vitest';
import { NayaDeskClient } from '../src/crm/nayadesk-client.js';

/**
 * Wave 1: the hold write must hit /api/v1/holds (Desk type-pick), not the
 * legacy /api/projects/:id/holds URL. The adapter already names a type;
 * swapping only the path without builder_id would 400.
 */
describe('placeHold posts /api/v1/holds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends builder, project, type, and thread on the v1 door', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hold_id: 'hld_1',
          unit_id: 'u1',
          unit_number: 'A-101',
          status: 'active',
          expires_at: 1,
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const crm = new NayaDeskClient({ nayadeskUrl: 'https://desk.test', botSecret: 's' });
    const r = await crm.placeHold({
      builder_id: 'sandbox',
      project_id: 'proj',
      unit_type: '2 BHK',
      thread_id: 'c1',
      ttl_minutes: 60,
    });

    expect(r.status).toBe('active');
    expect(r.unit_number).toBe('A-101');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://desk.test/api/v1/holds');
    expect(JSON.parse(String(init.body))).toMatchObject({
      builder_id: 'sandbox',
      project_id: 'proj',
      unit_type: '2 BHK',
      thread_id: 'c1',
      ttl_minutes: 60,
    });
    expect((init.headers as Record<string, string>)['x-bot-secret']).toBe('s');
  });
});
