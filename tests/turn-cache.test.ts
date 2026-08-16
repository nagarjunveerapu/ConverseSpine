import { describe, expect, it } from 'vitest';
import {
  embKey,
  hashConstraints,
  hashKey,
  intentQueryKey,
  projKey,
  searchKey,
  segKey,
} from '../src/cache/turn-cache.js';

describe('turn-cache keys', () => {
  it('normalizes segment area', () => {
    expect(segKey('brigade-group', '  Whitefield  ', 'Apartment')).toBe(
      'seg:brigade-group:whitefield:apartment',
    );
  });

  it('stable constraint hash', () => {
    const a = hashConstraints({ locations: ['a'], budgetMax: 1 });
    const b = hashConstraints({ budgetMax: 1, locations: ['a'] });
    expect(a).toBe(b);
    expect(searchKey('b', a)).toBe(`search:b:${a}`);
  });

  it('project and embed keys', () => {
    expect(projKey('brigade-eldorado')).toBe('proj:brigade-eldorado');
    expect(embKey('p256', 'What is the price?')).toBe(
      `emb:p256:${hashKey('what is the price?')}`,
    );
    expect(intentQueryKey('p256', 'idx-a', 'What is the price?', 'brigade-group')).toBe(
      `ivq:p256:idx-a:${hashKey('what is the price?')}:brigade-group`,
    );
  });

  it('the intent-query cache is per index, not just per projection', () => {
    // This caches the RESULT of querying one index, and dev/projdev/ctrldev/
    // local share a single TURN_CACHE namespace. Measured 16 Aug 2026 before
    // the index went into the key: two arms on two different indices, asked the
    // same novel phrasing in either order, returned the SAME score to eight
    // decimal places — the second arm never queried its own index at all.
    const q = 'do the towers here have piped gas connection already';
    expect(intentQueryKey('p256', 'naya-intent-p256-f6665e0b79-full-dev', q, 'b')).not.toBe(
      intentQueryKey('p256', 'naya-intent-p256-f6665e0b79-canon-dev', q, 'b'),
    );
    // …while the same index still hits, or the cache stops being a cache.
    expect(intentQueryKey('p256', 'idx-a', q, 'b')).toBe(intentQueryKey('p256', 'idx-a', q, 'b'));
  });
});
