/**
 * Two envs on the same projection, pointing at different indices, must not
 * share a rebuild manifest.
 *
 * The manifest is the ONLY thing that decides whether a row gets embedded:
 * `manifest[id] !== contentHash(row)`. It lives in TURN_CACHE, and dev,
 * projdev, ctrldev and local all share one TURN_CACHE namespace. dev and
 * projdev also share the projection `p256-f6665e0b79` — so before this fix they
 * read and wrote one key, `sil:intent-manifest:v1:p256-f6665e0b79`, describing
 * two different Vectorize indices.
 *
 * Measured 16 Aug 2026, which is what makes this a bug and not a theory:
 *
 *   naya-intent-p256-f6665e0b79-full-dev   23,110 vectors   written 11 Aug
 *   naya-intent-p256-f6665e0b79-dev        10,646 vectors   written 23 Jul
 *   sil:intent-manifest:v1:p256-f6665e0b79  8,727 entries   (dev's writes)
 *
 * A rebuild on projdev reads dev's manifest, finds every row "unchanged",
 * pushes nothing, and returns `ok: true` over an index 12,464 vectors behind.
 * It is the space bug one level down, and it fails the same silent way.
 */
import { describe, expect, it } from 'vitest';
import { intentManifestKey } from '../src/rebuild/intent-index.js';
import { PROJECTION_ID } from '../src/nlu/intent-projection-matrix.js';
import type { Env } from '../src/env.js';

const env = (o: Partial<Env>): Env => o as Env;
const PROJECTED = { SIL_INTENT_PROJECTION: PROJECTION_ID };

describe('intent rebuild manifest key', () => {
  it('separates two indices that share a projection', () => {
    // The exact dev/projdev collision, in the two names they actually carry.
    const dev = intentManifestKey(
      env({ ...PROJECTED, SIL_INTENT_INDEX: 'naya-intent-p256-f6665e0b79-full-dev' }),
    );
    const projdev = intentManifestKey(
      env({ ...PROJECTED, SIL_INTENT_INDEX: 'naya-intent-p256-f6665e0b79-dev' }),
    );
    expect(dev).not.toBe(projdev);
  });

  it('still separates two projections, as it always did', () => {
    // The original guarantee has to survive the new one.
    expect(intentManifestKey(env({ ...PROJECTED, SIL_INTENT_INDEX: 'x' }))).not.toBe(
      intentManifestKey(env({ SIL_INTENT_INDEX: 'x' })),
    );
  });

  it('a fresh index name yields a fresh manifest, so the cutover re-embeds', () => {
    // This is the property the canonical cutover depends on: pointing an env at
    // a NEW index must not inherit the old index's "already embedded" record,
    // or the new index is queried while empty.
    const before = intentManifestKey(
      env({ ...PROJECTED, SIL_INTENT_INDEX: 'naya-intent-p256-f6665e0b79-full-dev' }),
    );
    const after = intentManifestKey(
      env({ ...PROJECTED, SIL_INTENT_INDEX: 'naya-intent-p256-f6665e0b79-canon-dev' }),
    );
    expect(after).not.toBe(before);
  });

  it('reproduces the legacy key exactly when unset — rollback stays free', () => {
    // Reverting the config must land back on the manifest that truly describes
    // the old index. If this drifted, a rollback would re-embed 8,727 rows to
    // rediscover what was already there.
    expect(intentManifestKey(env(PROJECTED))).toBe(`sil:intent-manifest:v1:${PROJECTION_ID}`);
    expect(intentManifestKey(env({}))).toBe('sil:intent-manifest:v1');
  });

  it('treats whitespace as unset rather than keying on an empty suffix', () => {
    // A var set to "" in a config would otherwise produce `…:p256-…:` — a third
    // key that describes nothing.
    expect(intentManifestKey(env({ ...PROJECTED, SIL_INTENT_INDEX: '  ' }))).toBe(
      intentManifestKey(env(PROJECTED)),
    );
  });
});
