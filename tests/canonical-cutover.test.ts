/**
 * Flipping SIL_CANONICAL_EMBED must actually re-embed the corpus.
 *
 * The flag flips the corpus and the live query together — that is the whole
 * point, because a canonical query against a raw index is two different vector
 * spaces and recognition quietly collapses. The query side flips instantly
 * (`semantic-nlu.ts` reads the env var per turn). The corpus side only moves
 * when the nightly rebuild decides a row `changed`, and that decision is
 * `manifest[id] !== contentHash(row)`.
 *
 * `contentHash` canonicalizes unconditionally, so it returns the SAME value in
 * both modes. Flip the flag and every row still hashes to what the legacy run
 * wrote: nothing is `changed`, nothing re-embeds, and the index stays raw while
 * every buyer's query goes canonical.
 *
 * The file already knows this should not happen — line 112 promises "flipping
 * raw→canonical invalidates every manifest entry and forces a clean re-embed",
 * which is what the code does NOT do, and the RebuildOptions doc quietly says
 * the operator must remember a manual manifest reset instead. A cutover that
 * depends on remembering is the one that gets forgotten at 3am.
 *
 * So the hash covers the embed MODE, not just the row. Then the flip
 * invalidates the manifest by construction and the promise in the comment
 * becomes true.
 */
import { describe, expect, it } from 'vitest';
import { contentHash, embedTextForRow, planRebuild, type RegistryRow } from '../src/rebuild/intent-index.js';
import { canonicalize } from '../src/nlu/canonicalize.js';

/** A row that really does mask — otherwise the test proves nothing about mode. */
const ROW: RegistryRow = {
  id: 'cut-1',
  phrasing: 'what is the price of Brigade Eldorado in Whitefield',
  intent_kind: 'get_price',
  audit_status: 'machine_v2',
};

describe('SIL_CANONICAL_EMBED cutover', () => {
  it('the fixture actually changes under canonicalization', () => {
    // Guards the guard: if the vocab stops masking these tokens, every
    // assertion below would pass vacuously.
    expect(canonicalize(ROW.phrasing)).not.toBe(ROW.phrasing.toLowerCase());
    expect(embedTextForRow(ROW, canonicalize, true)).not.toBe(
      embedTextForRow(ROW, canonicalize, false),
    );
  });

  it('the manifest hash distinguishes the two embed modes', () => {
    // What gets embedded differs, so what the manifest records must differ.
    expect(contentHash(ROW, true)).not.toBe(contentHash(ROW, false));
  });

  it('flipping the flag marks every row for re-embed', () => {
    // A manifest written by a legacy-mode run…
    const legacyManifest = { [ROW.id]: contentHash(ROW, false) };
    // …must not satisfy a canonical-mode run.
    const plan = planRebuild([ROW], legacyManifest, { canonicalMode: true });
    expect(plan.changed.map((r) => r.id)).toEqual([ROW.id]);
    // And nothing is deleted — the ids are stable, the vectors are overwritten.
    expect(plan.toRemove).toEqual([]);
  });

  it('a steady-state run in the same mode still skips unchanged rows', () => {
    // The incremental pipeline has to stay incremental, or every rebuild
    // re-embeds the whole corpus and the flag becomes a nightly cost.
    const canonManifest = { [ROW.id]: contentHash(ROW, true) };
    expect(planRebuild([ROW], canonManifest, { canonicalMode: true }).changed).toEqual([]);
    const rawManifest = { [ROW.id]: contentHash(ROW, false) };
    expect(planRebuild([ROW], rawManifest, {}).changed).toEqual([]);
  });
});
