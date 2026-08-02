/**
 * Append-only teach upsert → dig /internal/intent-vector.
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev... \
 *   npx tsx scripts/upsert-intent-vectors.ts corpus/pending/visit-mv-teach/upsert-items.jsonl
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

function loadBotSecret(): string {
  if (process.env.BOT_SHARED_SECRET) return process.env.BOT_SHARED_SECRET.trim();
  try {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('BOT_SHARED_SECRET='));
    return line ? line.slice('BOT_SHARED_SECRET='.length).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

async function main() {
  const file = resolve(process.argv[2] || 'corpus/pending/visit-mv-teach/upsert-items.jsonl');
  const base = (process.env.CONVERSE_SPINE_URL || 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
    /\/$/,
    '',
  );
  const secret = loadBotSecret();
  if (!secret) {
    console.error('BOT_SHARED_SECRET missing (.dev.vars or env)');
    process.exit(1);
  }
  const items = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string; text: string; metadata?: Record<string, unknown> });
  console.log(`upsert ${items.length} items → ${base}/internal/intent-vector`);

  const reports: unknown[] = [];
  let written = 0;
  let errors = 0;
  const BATCH = 100;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const resp = await fetch(`${base}/internal/intent-vector`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bot-secret': secret,
      },
      body: JSON.stringify({ op: 'upsert', items: batch }),
    });
    const body = (await resp.json()) as {
      ok?: boolean;
      written?: number;
      space?: string;
      model?: string;
      errors?: string[];
    };
    reports.push({ http: resp.status, batch_start: i, size: batch.length, ...body });
    if (!resp.ok || body.ok === false) {
      errors += 1;
      console.error('batch fail', i, body);
    } else {
      written += body.written ?? batch.length;
      console.log(`  +${body.written ?? batch.length} (space=${body.space})`);
    }
  }

  const out = {
    base,
    file,
    items: items.length,
    written,
    errors,
    reports,
    at: new Date().toISOString(),
  };
  const outPath = resolve(dirname(file), `${basename(file, '.jsonl').replace(/-items$/, '')}-result.json`);
  // upsert-items.jsonl → upsert-result.json
  const resultPath = resolve(dirname(file), 'upsert-result.json');
  writeFileSync(resultPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${resultPath} (${written}/${items.length}, errors=${errors})`);
  if (errors) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
