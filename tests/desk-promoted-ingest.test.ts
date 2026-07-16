import { describe, it, expect } from 'vitest';
import { mergeDeskPromoted, planRebuild, type RegistryRow } from '../src/rebuild/intent-index.js';
import { makeCanonicalizer } from '../src/nlu/canonicalize.js';

const canon = makeCanonicalizer({
  places: ['whitefield'],
  builders: ['brigade'],
  projects: ['brigade oasis', 'godrej splendour'],
});

const REGISTRY: RegistryRow[] = [
  { id: 'r1', phrasing: 'what is the price', intent_kind: 'get_price', audit_status: 'machine_v2', eval_split: 'train' },
  // Frozen holdout row — its canonical is 'price of <project>'.
  { id: 'h1', phrasing: 'price of Brigade Oasis', intent_kind: 'get_price', audit_status: 'machine_v2', eval_split: 'holdout' },
];

describe('mergeDeskPromoted — Wave B safe lane invariants', () => {
  it('accepts a normal desk row as desk_promoted/train', () => {
    const out = mergeDeskPromoted(REGISTRY, [
      { id: 'desk_q9', phrasing: 'kya gaushala paas hai', intent_kind: 'get_location_info', language: 'hi-en' },
    ], canon);
    expect(out.added).toBe(1);
    expect(out.holdout_collisions).toBe(0);
    const added = out.rows.find((r) => r.id === 'desk_q9')!;
    expect(added).toMatchObject({ audit_status: 'desk_promoted', eval_split: 'train' });
  });

  it('HOLDOUT GUARD: a desk phrasing that canonicalizes onto a holdout row is dropped', () => {
    // Different project, same canonical shape as the holdout row → leakage risk.
    const out = mergeDeskPromoted(REGISTRY, [
      { id: 'desk_q1', phrasing: 'price of Godrej Splendour', intent_kind: 'get_price' },
    ], canon);
    expect(out.added).toBe(0);
    expect(out.holdout_collisions).toBe(1);
    expect(out.rows).toHaveLength(REGISTRY.length);
  });

  it('registry wins on id collision; malformed desk rows skipped', () => {
    const out = mergeDeskPromoted(REGISTRY, [
      { id: 'r1', phrasing: 'shadow attempt', intent_kind: 'get_price' },
      { id: '', phrasing: 'no id', intent_kind: 'get_price' },
      { id: 'desk_q2', phrasing: '', intent_kind: 'get_price' },
    ], canon);
    expect(out.added).toBe(0);
    expect(out.rows.find((r) => r.id === 'r1')!.phrasing).toBe('what is the price');
  });
});

describe('planRebuild × desk_promoted eligibility', () => {
  const deskRow: RegistryRow = {
    id: 'desk_q9', phrasing: 'kya gaushala paas hai', intent_kind: 'get_location_info',
    audit_status: 'desk_promoted', eval_split: 'train',
  };

  it('ships in canonical mode', () => {
    const plan = planRebuild([deskRow], {}, { canonicalMode: true });
    expect(plan.eligible.map((r) => r.id)).toEqual(['desk_q9']);
  });

  it('stays dark in legacy mode (clean-only floor holds)', () => {
    const plan = planRebuild([deskRow], {}, {});
    expect(plan.eligible).toHaveLength(0);
  });

  it('a dismissed promotion disappears from the feed → manifest removes its vector', () => {
    // Yesterday's manifest had the desk row; today's feed no longer returns it.
    const manifest = { desk_q9: 'somehash' };
    const plan = planRebuild([], manifest, { canonicalMode: true });
    expect(plan.toRemove).toEqual(['desk_q9']);
  });
});
