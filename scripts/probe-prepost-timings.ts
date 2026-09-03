#!/usr/bin/env npx tsx
/** One-off dig probe: pre_extract / post_compose attribution on warm packed turns. */
const SPINE = (
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev'
).replace(/\/+$/, '');

type Timings = Record<string, number | undefined>;

function fmt(t: Timings | undefined): string {
  if (!t) return '(no timings)';
  const keys = [
    'pre_extract_ms',
    'extract_ms',
    'mid_pre_goal_ms',
    'mid_catalog_ms',
    'mid_location_ms',
    'mid_phase_prep_ms',
    'routing_ms',
    'evidence_ms',
    'goal_ms',
    'compose_ms',
    'post_compose_ms',
    'store_save_ms',
    'crm_pre_ms',
    'total_ms',
  ] as const;
  const parts = keys.map((k) => `${k.replace(/_ms$/, '')}=${t[k] ?? '—'}`);
  // routing_ms may overlap extract (GO H early parallel) OR nest inside
  // mid_pre_goal (serial mid await). mid_* sub-slices nest under mid — do not
  // subtract them again from residual.
  const known = [
    'pre_extract_ms',
    'extract_ms',
    'mid_pre_goal_ms',
    'evidence_ms',
    'goal_ms',
    'compose_ms',
    'post_compose_ms',
    'store_save_ms',
  ] as const;
  const sum = known.reduce((a, k) => a + (Number(t[k]) || 0), 0);
  const total = Number(t.total_ms) || 0;
  const routing = Number(t.routing_ms) || 0;
  const extract = Number(t.extract_ms) || 0;
  // When routing ≤ extract and mid is small, routing likely overlapped under extract.
  const overlapHint =
    routing > 0 && extract > 0 && routing <= extract + 50
      ? `  (routing~overlapped under extract)`
      : '';
  return `${parts.join('  ')}  residual=${total - sum}${overlapHint}`;
}

async function chat(phone: string, text: string, cid?: string) {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: 'brigade-group',
      buyer_phone: phone,
      text,
      channel: 'api',
      ...(cid ? { thread_id: cid } : {}),
    }),
  });
  return (await r.json()) as Record<string, unknown>;
}

async function main() {
  const phone = `9198777${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  let cid: string | undefined;
  const turns = [
    'hi',
    'Brigade Eldorado',
    'brochure and RERA',
    'schools nearby and starting price?',
  ];
  console.log('SPINE', SPINE);
  console.log('phone', phone);
  for (const text of turns) {
    const d = await chat(phone, text, cid);
    cid = (d.thread_id as string | undefined) || cid;
    const dbg = (d.debug as Record<string, unknown> | undefined) || {};
    const t = dbg.timings as Timings | undefined;
    const reply = String(d.reply_text ?? d.reply ?? '')
      .slice(0, 140)
      .replace(/\n/g, ' ');
    console.log(`\n=== ${text} ===`);
    console.log(fmt(t));
    console.log('cache', JSON.stringify(dbg.cache || {}));
    console.log('reply:', reply);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
