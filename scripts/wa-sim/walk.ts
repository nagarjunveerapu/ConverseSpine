/**
 * One buyer, one walk, against the DEPLOYED dev worker — the founder's own
 * sequence, replayed so a defect can be seen instead of guessed at.
 *
 *   npx tsx scripts/wa-sim/walk.ts
 *
 * Steps are `text` or `tap:<action_id>|<label>`; every reply prints as the
 * bubble plus the rows the buyer would see, so a tap can be read off the list
 * that drew it.
 */
const ENDPOINT =
  process.env.WA_LIVE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev/chat';
const BUILDER = process.env.WA_LIVE_BUILDER ?? 'brigade-group';
const PHONE = process.env.WA_WALK_PHONE ?? `+9198${String(Date.now()).slice(-8)}`;

interface Row {
  id: string;
  title: string;
  description?: string;
}
interface Packed {
  type?: string;
  action?: { sections?: Array<{ title?: string; rows?: Row[] }>; buttons?: unknown[] };
  interactive?: unknown;
}

const STEPS: string[] = process.env.WA_WALK_STEPS
  ? JSON.parse(process.env.WA_WALK_STEPS)
  : [
      '/reset',
      'Help me choose',
      '2 BHK',
      'Under ₹1 Cr',
      'tap:wa.pick.brigade-eldorado|Brigade Eldorado',
      'tap:wa.node.trust@brigade-eldorado|Trust & legal',
      'tap:wa.doc.ownership_certificate@brigade-eldorado|Ownership certificate',
      'tap:wa.back.file@brigade-eldorado|← Back to the file',
      'tap:wa.node.life@brigade-eldorado|Life',
      'tap:visit_book|Book a visit',
      'tap:wa.day.sunday|Sun 16 Aug',
    ];

let convId: string | undefined;

function rowsOf(packed: unknown): Row[] {
  const p = packed as Packed | undefined;
  const sections = p?.action?.sections ?? [];
  return sections.flatMap((s) => s.rows ?? []);
}

async function main(): Promise<void> {
  const health = await fetch(ENDPOINT.replace(/\/chat$/, '/health')).catch(() => null);
  const build = health?.ok ? ((await health.json()) as { version?: string }).version : 'unknown';
  console.log(`# build ${build} · phone ${PHONE}\n`);

  for (const step of STEPS) {
    const isTap = step.startsWith('tap:');
    const [actionId, label] = isTap ? step.slice(4).split('|') : [undefined, step];
    const res = (await (
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          builder_id: BUILDER,
          buyer_phone: PHONE,
          text: label,
          channel: 'whatsapp',
          ...(convId ? { conversation_id: convId } : {}),
          ...(actionId ? { action_id: actionId } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      })
    ).json()) as Record<string, unknown>;
    convId = (res.conversation_id as string) ?? convId;

    console.log('─'.repeat(70));
    console.log(`▶ ${isTap ? `TAP ${actionId} ("${label}")` : `"${label}"`}`);
    console.log(String(res.reply_text ?? res.reply ?? '(no reply)'));
    const media = res.media as Array<{ asset_kind?: string; label?: string }> | undefined;
    if (media?.length) {
      console.log(`   📎 MEDIA: ${media.map((m) => `${m.asset_kind}:${m.label}`).join(' · ')}`);
    }
    const rows = rowsOf(res.whatsapp_interactive);
    for (const r of rows) {
      console.log(`   • [${r.id}] ${r.title}${r.description ? ` — ${r.description}` : ''}`);
    }
    const dbg = res.debug as { goal?: { kind?: string }; phase?: string } | undefined;
    if (dbg) console.log(`   ⋯ phase=${dbg.phase} goal=${dbg.goal?.kind}`);
  }
}

void main();
