import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard: ONE source of truth for the embedding model.
 *
 * Query-side and index-side must embed with the same model. Different models
 * produce different vector spaces, so a mismatch does not fail loudly — it
 * silently destroys retrieval while every test and typecheck stays green.
 *
 * This nearly shipped: the rebuild and auto-teach read `env.SIL_EMBED_MODEL`
 * while `turn-routing/classify.ts` and `adapters/semantic-nlu.ts` hardcoded
 * `@cf/baai/bge-base-en-v1.5`. Swapping the model would have indexed with the
 * new one and queried with the old.
 *
 * A model id may appear ONLY as a `DEFAULT_*`/`DEFAULT_MODEL` fallback next to
 * an `env.SIL_EMBED_MODEL` read. Anywhere else, use the env value.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('embedding model has a single source of truth', () => {
  it('never hardcodes a model id outside a DEFAULT_* fallback', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (!line.includes('@cf/baai/')) return;
        // Allowed: the named default constant that sits beside an env read.
        if (/(?:DEFAULT_EMBED_MODEL|DEFAULT_MODEL|SIL_EMBED_MODEL)\s*[:=]/.test(line)) return;
        offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `hardcoded embed model — use env.SIL_EMBED_MODEL:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('every embed call site can be pointed at a different model', () => {
    // If a swap is possible, the string 'SIL_EMBED_MODEL' must appear in each
    // file that calls AI.run with an embedding — otherwise that call is pinned.
    const pinned: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      const embeds = /\bAI\.run\(|\bai\.run\(/.test(text);
      if (!embeds) continue;
      if (!text.includes('SIL_EMBED_MODEL')) pinned.push(file);
    }
    expect(pinned, `AI.run present but no SIL_EMBED_MODEL read:\n${pinned.join('\n')}`).toEqual([]);
  });
});
