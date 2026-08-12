#!/usr/bin/env npx tsx
/** Dig quality smoke — packed multi-intent + cost-stance; fail on thinning. */
const SPINE = (
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev'
).replace(/\/+$/, '');

async function chat(phone: string, text: string, cid?: string) {
  const t0 = Date.now();
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: 'brigade-group',
      buyer_phone: phone,
      text,
      channel: 'api',
      ...(cid ? { conversation_id: cid } : {}),
    }),
  });
  const d = (await r.json()) as Record<string, unknown>;
  return { d, wall: Date.now() - t0, status: r.status };
}

function fullReply(d: Record<string, unknown>): string {
  return String(d.reply_text ?? d.reply ?? '');
}

/** Multiple BHK configs + a from-price floor — overview must stay rich. */
function overviewLooksThin(reply: string): boolean {
  const bhkHits = reply.match(/\b\d\s*BHK\b/gi) ?? [];
  const uniqueBhks = new Set(bhkHits.map((s) => s.replace(/\s+/g, '').toUpperCase()));
  const hasFromPrice = /from\s*₹|starting\s*(?:at|from)?\s*₹|₹\s*[\d,.]+?\s*L/i.test(reply);
  return uniqueBhks.size < 2 || !hasFromPrice;
}

function brochureAndReraThin(reply: string): boolean {
  const hasBrochure = /brochure|pdf|download|📎|document/i.test(reply);
  const hasRera = /RERA|PRM[\w/-]+|registration\s*no/i.test(reply);
  return !hasBrochure || !hasRera;
}

function schoolsAndPriceThin(reply: string): boolean {
  const hasPrice = /₹|lakh|cr\b|crore|starting|from\s*₹|price/i.test(reply);
  return !hasPrice;
}

async function main() {
  const journeys: [string, string[]][] = [
    ['packed-price-legal', ['hi', 'Brigade Eldorado', 'brochure and RERA please']],
    [
      'packed-schools-price',
      [
        'hi',
        '2 BHK apartment in Devanahalli under 1.5 Cr',
        'Brigade Eldorado',
        'schools nearby and starting price?',
      ],
    ],
    [
      'cost-stance',
      [
        'hi',
        '2 BHK apartment in North Bangalore under 1.5 Cr',
        'Brigade Eldorado',
        'a bit expensive for me',
      ],
    ],
  ];
  let flags = 0;
  for (const [jid, turns] of journeys) {
    const phone = `9198666${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
    let cid: string | undefined;
    console.log('===', jid, '===');
    for (const t of turns) {
      const { d, wall, status } = await chat(phone, t, cid);
      if (status !== 200) {
        console.log('  HTTP', status, d);
        flags++;
        break;
      }
      cid = String(d.conversation_id ?? '');
      const replyFull = fullReply(d);
      const reply = replyFull.slice(0, 260).replace(/\n/g, ' ');
      const dbg = (d.debug as Record<string, unknown>) || {};
      const timings = (dbg.timings as Record<string, number> | undefined) || {};
      console.log(
        `  [${wall}ms] goal=${JSON.stringify(dbg.goal)} cache=${JSON.stringify(dbg.cache)} llm=${dbg.llm_used}` +
          (timings.extract_ms != null ? ` ex=${timings.extract_ms}` : '') +
          (timings.evidence_ms != null ? ` ev=${timings.evidence_ms}` : '') +
          (timings.goal_ms != null ? ` goal_ms=${timings.goal_ms}` : '') +
          (timings.store_save_ms != null ? ` store=${timings.store_save_ms}` : '') +
          (timings.crm_pre_ms != null ? ` crm=${timings.crm_pre_ms}` : '') +
          (timings.compose_ms != null ? ` co=${timings.compose_ms}` : '') +
          (timings.total_ms != null ? ` tot=${timings.total_ms}` : ''),
      );
      console.log('   →', reply);

      if (/couldn.t make sense|as an ai|i don.t understand/i.test(replyFull)) {
        console.log('   !! QUALITY FLAG nonsense');
        flags++;
      }
      if (t === 'Brigade Eldorado' && overviewLooksThin(replyFull)) {
        console.log('   !! QUALITY FLAG overview thinned (need ≥2 BHKs + from ₹)');
        flags++;
      }
      if (jid === 'packed-price-legal' && /brochure and RERA/i.test(t) && brochureAndReraThin(replyFull)) {
        console.log('   !! QUALITY FLAG brochure+RERA thinned');
        flags++;
      }
      if (
        jid === 'packed-schools-price' &&
        /schools nearby and starting price/i.test(t) &&
        schoolsAndPriceThin(replyFull)
      ) {
        console.log('   !! QUALITY FLAG schools+price missing price signal');
        flags++;
      }
      if (
        jid === 'cost-stance' &&
        t.includes('expensive') &&
        (dbg.goal as { kind?: string })?.kind === 'clarify_intent'
      ) {
        console.log('   !! QUALITY FLAG cost-stance→clarify');
        flags++;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.log('quality_flags', flags);
  if (flags) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
