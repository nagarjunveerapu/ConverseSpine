import { describe, expect, it } from 'vitest';
import { contentHash, parseJsonl, planRebuild } from '../src/rebuild/intent-index.js';
import type { RegistryRow } from '../src/rebuild/intent-index.js';

/**
 * SIL data pipeline — the weekly rebuild's diff logic is pure and must be
 * exact: it decides what gets embedded (cost) and what gets deleted (data
 * loss). These pin the quarantine gate, the incremental diff, and de-listing.
 */

const clean = (over: Partial<RegistryRow>): RegistryRow => ({
  id: 'x',
  phrasing: 'what is the price',
  intent_kind: 'get_price',
  audit_status: 'clean',
  quarantine: false,
  ...over,
});

describe('SIL rebuild planner', () => {
  it('quarantine gate: only clean, non-quarantined rows are eligible', () => {
    const rows = [
      clean({ id: 'a' }),
      clean({ id: 'b', quarantine: true }), // quarantined → excluded
      clean({ id: 'c', audit_status: 'unaudited' }), // not yet audited → excluded
      { id: 'd', phrasing: 'hi', intent_kind: 'small_talk' } as RegistryRow, // no audit fields → excluded
    ];
    const { eligible } = planRebuild(rows, {});
    expect(eligible.map((r) => r.id)).toEqual(['a']);
  });

  it('LEGACY mode (default) keeps the clean-only floor — v2/mined stay dark', () => {
    const rows = [
      clean({ id: 'a', audit_status: 'clean' }),
      clean({ id: 'b', audit_status: 'machine_v2' }), // NOT shipped until the flag flips
      clean({ id: 'c', audit_status: 'mined_yantra_v1' }),
    ];
    const { eligible } = planRebuild(rows, {}); // canonicalMode omitted → legacy
    expect(eligible.map((r) => r.id)).toEqual(['a']);
  });

  it('canonicalMode gate ships v2 + mined: machine_v2 and mined_yantra_v1 eligible', () => {
    const rows = [
      clean({ id: 'a', audit_status: 'machine_v2' }), // registry v2 → eligible
      clean({ id: 'b', audit_status: 'mined_yantra_v1' }), // mined → eligible
      clean({ id: 'c', audit_status: 'machine_v2', quarantine: true }), // still gated by quarantine
      clean({ id: 'd', audit_status: 'unaudited' }), // unknown status → excluded
    ];
    const { eligible } = planRebuild(rows, {}, { canonicalMode: true });
    expect(eligible.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('held-out rows are NEVER embedded, even when eligible — eval stays measurable', () => {
    const rows = [
      clean({ id: 'a', audit_status: 'machine_v2', eval_split: 'train' }),
      clean({ id: 'b', audit_status: 'machine_v2', eval_split: 'holdout' }), // frozen eval → excluded
      clean({ id: 'c', eval_split: 'holdout' }), // clean but holdout → excluded
    ];
    const { eligible } = planRebuild(rows, {}, { canonicalMode: true });
    expect(eligible.map((r) => r.id)).toEqual(['a']);
  });

  it('seed mode still excludes held-out rows (pushUnaudited is not a holdout bypass)', () => {
    const rows = [
      clean({ id: 'a', audit_status: 'unaudited', eval_split: 'train' }),
      clean({ id: 'b', audit_status: 'unaudited', eval_split: 'holdout' }),
    ];
    const { eligible } = planRebuild(rows, {}, { pushUnaudited: true });
    expect(eligible.map((r) => r.id)).toEqual(['a']);
  });

  it('seed mode (pushUnaudited) ignores the gate but still needs well-formed rows', () => {
    const rows = [
      clean({ id: 'a', audit_status: 'unaudited' }),
      { id: '', phrasing: 'x', intent_kind: 'get_price' } as RegistryRow, // no id → still excluded
      { id: 'b', phrasing: '', intent_kind: 'get_price' } as RegistryRow, // no phrasing → excluded
    ];
    const { eligible } = planRebuild(rows, {}, { pushUnaudited: true });
    expect(eligible.map((r) => r.id)).toEqual(['a']);
  });

  it('incremental: only new or content-changed rows are pushed', () => {
    const a = clean({ id: 'a' });
    const b = clean({ id: 'b', phrasing: 'emi for 50 lakh', intent_kind: 'compute_emi' });
    const manifest = { a: contentHash(a) }; // a already in index at this content
    const { changed } = planRebuild([a, b], manifest);
    expect(changed.map((r) => r.id)).toEqual(['b']); // a unchanged, b new
  });

  it('a changed phrasing re-pushes even if the id is unchanged', () => {
    const before = clean({ id: 'a', phrasing: 'price?' });
    const manifest = { a: contentHash(before) };
    const after = clean({ id: 'a', phrasing: 'what is the total price?' });
    const { changed } = planRebuild([after], manifest);
    expect(changed.map((r) => r.id)).toEqual(['a']);
  });

  it('de-listing: a row that fell out of the clean set is removed from the index', () => {
    const a = clean({ id: 'a' });
    // manifest has a + stale, but only a is eligible now → stale must be deleted
    const manifest = { a: contentHash(a), stale: 'deadbeef' };
    const { toRemove } = planRebuild([a], manifest);
    expect(toRemove).toEqual(['stale']);
  });

  it('parseJsonl tolerates blank and malformed lines', () => {
    const text = '{"id":"a","phrasing":"p","intent_kind":"get_price"}\n\n{bad json}\n{"id":"b","phrasing":"q","intent_kind":"get_legal_info"}';
    const rows = parseJsonl(text);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('contentHash is deterministic and content-sensitive', () => {
    const r = clean({ id: 'a' });
    expect(contentHash(r)).toBe(contentHash({ ...r }));
    expect(contentHash(r)).not.toBe(contentHash({ ...r, intent_kind: 'get_legal_info' }));
    expect(contentHash(r)).not.toBe(contentHash({ ...r, is_negative: true }));
  });
});
