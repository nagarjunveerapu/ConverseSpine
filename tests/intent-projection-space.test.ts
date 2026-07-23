import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  gapFillTau,
  IDENTITY_TAU,
  IDENTITY_TAU_LOW,
  intentSpaceId,
  projectIntentVector,
  projectionActive,
  routingTau,
  PROJECTION_ID,
  PROJECTION_IN,
  PROJECTION_OUT,
  PROJECTION_TAU,
} from '../src/nlu/intent-projection.js';

/**
 * The learned intent metric only works if the index and the query live in the
 * SAME space. A mismatch does not throw — cosine happily returns numbers over
 * unrelated geometries — so it has to be prevented structurally.
 *
 * Same failure shape as the embed-model drift these tests already guard
 * (tests/embed-model-single-source.test.ts): silent, green, and catastrophic.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const OFF = {} as { SIL_INTENT_PROJECTION?: string };
const ON = { SIL_INTENT_PROJECTION: PROJECTION_ID };

describe('intent projection — identity by default', () => {
  it('is inert unless the env names this exact matrix', () => {
    expect(projectionActive(OFF)).toBe(false);
    expect(projectionActive({ SIL_INTENT_PROJECTION: 'p256-deadbeef00' })).toBe(false);
    expect(projectionActive(ON)).toBe(true);
  });

  it('returns the vector untouched when off', () => {
    const v = Array.from({ length: PROJECTION_IN }, (_, i) => (i % 7) / 10);
    expect(projectIntentVector(OFF, v)).toBe(v);
  });

  it('keeps the raw-model thresholds when off', () => {
    expect(routingTau(OFF)).toBe(IDENTITY_TAU);
    expect(gapFillTau(OFF)).toBe(IDENTITY_TAU_LOW);
    expect(intentSpaceId(OFF)).toBe('identity');
  });
});

describe('intent projection — active', () => {
  const v = Array.from({ length: PROJECTION_IN }, (_, i) => Math.sin(i) / 10);

  it('maps into the trained output width and returns a unit vector', () => {
    const p = projectIntentVector(ON, v);
    expect(p).toHaveLength(PROJECTION_OUT);
    const norm = Math.sqrt(p.reduce((a, x) => a + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(p.every(Number.isFinite)).toBe(true);
  });

  it('is linear — the same input always lands in the same place', () => {
    expect(projectIntentVector(ON, v)).toEqual(projectIntentVector(ON, v));
  });

  it('separates: two different vectors do not collapse to the same point', () => {
    const w = Array.from({ length: PROJECTION_IN }, (_, i) => Math.cos(i * 3) / 10);
    const a = projectIntentVector(ON, v);
    const b = projectIntentVector(ON, w);
    const cos = a.reduce((s, x, i) => s + x * b[i]!, 0);
    expect(Math.abs(cos)).toBeLessThan(0.999);
  });

  it('passes a wrong-width vector through rather than projecting garbage', () => {
    // A different embed model would produce a different width. Falling back to
    // the raw vector keeps the deployment on the raw metric; projecting it
    // would silently invent coordinates.
    const short = [0.1, 0.2, 0.3];
    expect(projectIntentVector(ON, short)).toBe(short);
  });

  it('uses the calibrated tau of this matrix, not the identity one', () => {
    expect(routingTau(ON)).toBe(PROJECTION_TAU);
    expect(routingTau(ON)).not.toBe(IDENTITY_TAU);
    expect(gapFillTau(ON)).toBeLessThan(routingTau(ON));
  });

  it('honours an explicit tau override', () => {
    expect(routingTau({ ...ON, SIL_ROUTING_TAU: '0.91' })).toBe(0.91);
    expect(routingTau({ ...ON, SIL_ROUTING_TAU: 'not-a-number' })).toBe(PROJECTION_TAU);
  });
});

describe('intent projection — no call site can bypass it', () => {
  it('every INTENT_VECTORS caller goes through the shared helper', () => {
    // Index-side and query-side must apply the SAME transform. Any file that
    // touches INTENT_VECTORS and does its own thing reintroduces the drift.
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      if (!/INTENT_VECTORS\s*\.\s*(query|upsert)/.test(text)) continue;
      if (!text.includes('projectIntentVector')) offenders.push(file);
    }
    expect(
      offenders,
      `queries/writes INTENT_VECTORS without the projection:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the configured Vectorize index names the space they are in', () => {
    // A projected deployment MUST NOT point at an index built in identity
    // space. Encoding the id in the index name makes that a config error you
    // can see, instead of a retrieval collapse you cannot.
    const toml = readFileSync('wrangler.toml', 'utf8');
    const blocks = toml.split(/\n(?=\[)/);
    for (const b of blocks) {
      if (!b.includes('INTENT_VECTORS')) continue;
      const name = /index_name\s*=\s*"([^"]+)"/.exec(b)?.[1];
      if (!name) continue;
      // Which env does this binding belong to? Match it against that env's
      // SIL_INTENT_PROJECTION value.
      const envMatch = /\[\[env\.(\w+)\.vectorize\]\]/.exec(b);
      const envName = envMatch?.[1];
      const varsBlock = envName
        ? new RegExp(`\\[env\\.${envName}\\.vars\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml)?.[1]
        : /\[vars\]([\s\S]*?)(?=\n\[|$)/.exec(toml)?.[1];
      const proj = varsBlock ? /SIL_INTENT_PROJECTION\s*=\s*"([^"]+)"/.exec(varsBlock)?.[1] : undefined;
      if (proj) {
        expect(name, `${envName ?? 'top-level'}: projection ${proj} needs an index named for it`)
          .toContain(proj);
      } else {
        expect(name, `${envName ?? 'top-level'}: no projection set, index must be identity-space`)
          .not.toMatch(/-p\d+-[0-9a-f]{10}/);
      }
    }
  });
});
