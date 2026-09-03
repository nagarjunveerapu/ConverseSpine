/**
 * Delivery receipts — the half of a WhatsApp send that never came home.
 *
 * The engine tells Desk what it composed; this tells Desk what happened to it.
 * Both halves are best-effort against the buyer's message: a receipt that
 * cannot be filed is a gap in the record, never a reason to fail a turn, so
 * every call here swallows its own error after saying so.
 */
import type { NayaDeskClient } from '../crm/nayadesk-client.js';
import type { WhatsAppDeliveryReport } from './wa-deliver.js';

/** One entry of Meta's `statuses` array, as the webhook delivers it. */
export interface MetaStatus {
  id?: string;
  status?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

/** Only these four mean anything to a row; anything else Meta invents is dropped. */
const KNOWN = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * Meta's failure, in words an agent can act on.
 *
 * `error_data.details` is the specific sentence ("Message failed to send
 * because more than 24 hours have passed since the customer last replied");
 * `title` is the category. Both, when both exist — the code alone is a number
 * nobody on a sales desk can read.
 */
export function statusDetail(s: MetaStatus): string {
  const e = s.errors?.[0];
  if (!e) return '';
  const said = e.error_data?.details || e.message || e.title || '';
  const code = e.code ? `${e.code}` : '';
  return [code, said].filter(Boolean).join(': ').slice(0, 400);
}

/** File what Graph said about each bubble of a turn we just sent. */
export async function fileTurnReceipts(
  crm: NayaDeskClient,
  builder_id: string,
  thread_id: string | undefined,
  report: WhatsAppDeliveryReport,
): Promise<void> {
  // No Desk thread means no rows to file against — an eval turn or a
  // demo. Silence here is correct; it is not a dropped receipt.
  if (!thread_id || !builder_id || report.parts.length === 0) return;
  await crm
    .reportWhatsAppDelivery({
      builder_id,
      thread_id,
      reports: report.parts.map((p) => ({
        content: p.content,
        status: p.status,
        ...(p.wamid ? { wamid: p.wamid } : {}),
        ...(p.detail ? { detail: p.detail } : {}),
      })),
    })
    .catch((err: unknown) => {
      console.error('[wa] delivery receipt not filed:', err instanceof Error ? err.message : String(err));
    });
}

/**
 * File Meta's own verdict, which arrives minutes after the send.
 *
 * This is the only place a message that Graph ACCEPTED and then did not
 * deliver becomes knowable. Meta answers 200 with a wamid and reports the
 * failure here — undeliverable number, closed 24-hour window, or its own
 * quality throttle. Spine has been receiving these on every bot message since
 * the webhook existed and dropping all of them at the `messages` guard.
 */
export async function fileStatusReceipts(
  crm: NayaDeskClient,
  builder_id: string,
  statuses: readonly MetaStatus[],
): Promise<void> {
  const reports = statuses
    .filter((s) => s.id && s.status && KNOWN.has(s.status))
    .map((s) => ({
      wamid: s.id!,
      status: s.status as 'sent' | 'delivered' | 'read' | 'failed',
      ...(statusDetail(s) ? { detail: statusDetail(s) } : {}),
    }));
  if (reports.length === 0 || !builder_id) return;
  const failed = reports.filter((r) => r.status === 'failed');
  // Logged as well as filed. A failure the tenant has not opened the thread to
  // see is still a failure someone has to be able to find.
  if (failed.length) console.error('[wa] meta reported failed delivery:', JSON.stringify(failed));
  await crm.reportWhatsAppDelivery({ builder_id, reports }).catch((err: unknown) => {
    console.error('[wa] status receipt not filed:', err instanceof Error ? err.message : String(err));
  });
}
