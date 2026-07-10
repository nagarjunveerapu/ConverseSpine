#!/usr/bin/env npx tsx
/**
 * Build a simple BEFORE (BAML off) vs AFTER (BAML on) HTML with per-turn quality.
 *
 *   npx tsx scripts/baml-quality-compare.ts \
 *     --before scenarios/runs/baml-... \
 *     --after scenarios/runs/baml-... \
 *     --out scenarios/runs/baml-quality.html
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface Turn {
  index: number;
  buyer: string;
  reply: string;
  pass: boolean;
  failures: string[];
  phase?: string;
  goalKind?: string;
  goalTopic?: string;
  speechAct?: string;
  baml?: {
    mode?: string;
    called?: boolean;
    would_fill?: string[];
    disagree?: string[];
    confidence?: string;
    abstain_reason?: string;
  };
}

interface Scenario {
  id: string;
  title: string;
  ok: boolean;
  turns: Turn[];
}

/** Desired outcome — product quality, not assert pass. */
function qualityVerdict(scenarioId: string, t: Turn): { grade: 'GOOD' | 'BAD' | 'WEAK'; why: string } {
  const reply = (t.reply || '').toLowerCase();
  const buyer = t.buyer.toLowerCase();

  // Placeholders / template leaks = always BAD
  if (/\[price\]|\[state real|something\.\.|no exact match for something\.\./i.test(t.reply)) {
    return { grade: 'BAD', why: 'Reply has placeholder or empty no_fit copy — not buyer-ready.' };
  }

  if (scenarioId === 'ADV-BAML-01') {
    if (t.index === 2) {
      // vague green/hills — desired: plantation/search shortlist OR clarifying probe, NOT empty no_fit
      if (t.goalKind === 'recommend' && /ayana|krishnaja|plantation|sakleshpur|coorg/i.test(reply)) {
        return { grade: 'GOOD', why: 'Offered a real shortlist for a soft plantation/hills brief.' };
      }
      if (t.goalKind === 'probe' || /what (area|budget)|which|tell me more about what/i.test(reply)) {
        return { grade: 'WEAK', why: 'Asked to clarify — acceptable, but a soft search shortlist would be better.' };
      }
      if (t.goalKind === 'no_fit' || /no exact match/i.test(reply)) {
        return { grade: 'BAD', why: 'Desired: treat as soft plantation/hills search → shortlist. Got no_fit.' };
      }
    }
    if (t.index === 3 && /ayana/.test(buyer)) {
      if (t.goalKind === 'answer' || t.goalKind === 'commit' || (t.phase === 'focused' && /ayana/i.test(reply))) {
        return { grade: 'GOOD', why: 'Committed/focused Ayana with project details.' };
      }
      if (/no exact match/i.test(reply) || t.goalKind === 'no_fit') {
        return { grade: 'BAD', why: 'Desired: Ayana is a known Lokations project → focus/overview. Got no_fit.' };
      }
    }
    if (t.index === 4 && /paperwork|legal|document/i.test(buyer)) {
      if (t.goalTopic === 'legal' || /rera|khata|ec|legal|title/i.test(reply)) {
        return { grade: 'GOOD', why: 'Answered legal/paperwork on focused project.' };
      }
      return { grade: 'BAD', why: 'Desired: legal facet on Ayana. Got clarify/no focus.' };
    }
    if (t.index === 5 && /see it|visit/i.test(buyer)) {
      if (t.phase === 'visit' || t.goalKind?.startsWith('visit') || /visit|day|time|coming from/i.test(reply)) {
        return { grade: 'GOOD', why: 'Entered visit scheduling.' };
      }
      return { grade: 'BAD', why: 'Desired: visit_book path. Did not schedule.' };
    }
  }

  // Harden / memory goldens — if assert pass and no placeholder, GOOD enough
  if (t.pass && !/\[price\]|no exact match for something/i.test(t.reply)) {
    if (/no exact match/i.test(reply) && scenarioId.startsWith('ADV-H')) {
      return { grade: 'BAD', why: 'Harden golden should stay on project — no_fit is wrong.' };
    }
    return { grade: 'GOOD', why: 'Matches expected golden behavior.' };
  }
  if (!t.pass) {
    return { grade: 'BAD', why: `Assert failed: ${t.failures.join('; ') || 'unknown'}` };
  }
  return { grade: 'WEAK', why: 'Pass asserts but copy needs human read.' };
}

function loadRun(dir: string): Map<string, Scenario> {
  const map = new Map<string, Scenario>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'summary.json')) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Scenario;
    map.set(s.id, s);
  }
  return map;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const beforeDir = arg('--before');
  const afterDir = arg('--after');
  const out = arg('--out') ?? 'scenarios/runs/baml-quality-compare.html';
  if (!beforeDir || !afterDir || !existsSync(beforeDir) || !existsSync(afterDir)) {
    console.error('Need --before <dir> --after <dir>');
    process.exit(1);
  }
  const before = loadRun(beforeDir);
  const after = loadRun(afterDir);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();

  const sections = ids
    .map((id) => {
      const b = before.get(id);
      const a = after.get(id);
      const n = Math.max(b?.turns.length ?? 0, a?.turns.length ?? 0);
      const turns = Array.from({ length: n }, (_, i) => {
        const bt = b?.turns[i];
        const at = a?.turns[i];
        const qBefore = bt ? qualityVerdict(id, bt) : null;
        const qAfter = at ? qualityVerdict(id, at) : null;
        const bamlOn = at?.baml?.called
          ? `ON · called · fill=${(at.baml.would_fill ?? []).join('|') || '—'} · ${at.baml.confidence}`
          : at
            ? 'ON · not called this turn'
            : '—';
        const bamlOff = bt?.baml?.called ? 'OFF but called? (unexpected)' : 'OFF · not called';
        return `<article class="turn">
  <header><strong>Turn ${i + 1}</strong> <code>${esc(bt?.buyer ?? at?.buyer ?? '')}</code></header>
  <div class="grid">
    <div class="col before">
      <div class="label">BEFORE — BAML off</div>
      <div class="grade ${qBefore?.grade.toLowerCase()}">${qBefore?.grade ?? '—'} — ${esc(qBefore?.why ?? '')}</div>
      <div class="meta">${esc(bamlOff)} · ${esc(bt?.phase ?? '')}/${esc(bt?.goalKind ?? '')}${bt?.goalTopic ? '/' + esc(bt.goalTopic) : ''}</div>
      <div class="reply">${esc(bt?.reply || '(missing)')}</div>
    </div>
    <div class="col after">
      <div class="label">AFTER — BAML on (promote)</div>
      <div class="grade ${qAfter?.grade.toLowerCase()}">${qAfter?.grade ?? '—'} — ${esc(qAfter?.why ?? '')}</div>
      <div class="meta">${esc(bamlOn)} · ${esc(at?.phase ?? '')}/${esc(at?.goalKind ?? '')}${at?.goalTopic ? '/' + esc(at.goalTopic) : ''}</div>
      <div class="reply">${esc(at?.reply || '(missing)')}</div>
    </div>
  </div>
</article>`;
      }).join('\n');
      return `<section><h2>${esc(id)} — ${esc(b?.title ?? a?.title ?? '')}</h2>${turns}</section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>BEFORE BAML off vs AFTER BAML on — quality</title>
<style>
body{font:15px/1.45 system-ui;background:#0f1419;color:#e8eef6;margin:0}
main{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:1.4rem} h2{margin-top:28px;font-size:1.1rem}
.note{background:#1a2430;border:1px solid #2c3b4d;padding:12px 14px;border-radius:10px;color:#9db0c5}
.turn{background:#151c24;border:1px solid #2a3544;border-radius:12px;padding:12px;margin:12px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.col{background:#0f1419;border-radius:8px;padding:10px}
.label{font-size:11px;text-transform:uppercase;color:#8b9bb0;margin-bottom:6px}
.grade{font-weight:600;margin-bottom:6px}
.grade.good{color:#3ecf8e}.grade.bad{color:#ff6b6b}.grade.weak{color:#ffb020}
.meta{font-size:12px;color:#8b9bb0;margin-bottom:8px}
.reply{white-space:pre-wrap}
code{font-size:13px}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>BEFORE (BAML off) vs AFTER (BAML on)</h1>
<div class="note">
  <p><strong>Segregation:</strong> Left = <code>BAML_EXTRACT_MODE=off</code>. Right = <code>promote</code> (BAML can fill gaps).</p>
  <p><strong>Quality:</strong> GOOD/WEAK/BAD is desired buyer outcome — not “did assert pass” and not greet wording drift.</p>
  <p><strong>Shadow</strong> is not shown here — shadow does not change replies, so it cannot answer “before vs after BAML.”</p>
</div>
${sections}
</main></body></html>`;

  writeFileSync(out, html);
  console.log('Wrote', out);
}

main();
