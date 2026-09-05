import { afterEach, describe, expect, it, vi } from 'vitest';
import { NayaDeskClient } from '../src/crm/nayadesk-client.js';

describe('createHoldRequest posts /api/v1/hold-requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends builder, project, type, and thread — never /holds', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          request_id: 'hrq_1',
          status: 'open',
          project_id: 'proj',
          unit_type: '2 BHK',
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const crm = new NayaDeskClient({ nayadeskUrl: 'https://desk.test', botSecret: 's' });
    const r = await crm.createHoldRequest({
      builder_id: 'sandbox',
      project_id: 'proj',
      unit_type: '2 BHK',
      thread_id: 'c1',
    });

    expect(r.request_id).toBe('hrq_1');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://desk.test/api/v1/hold-requests');
    expect(JSON.parse(String(init.body))).toMatchObject({
      builder_id: 'sandbox',
      project_id: 'proj',
      unit_type: '2 BHK',
      thread_id: 'c1',
      source: 'bot',
    });
  });
});
