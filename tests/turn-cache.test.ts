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
    expect(intentQueryKey('p256', 'What is the price?', 'brigade-group')).toBe(
      `ivq:p256:${hashKey('what is the price?')}:brigade-group`,
    );
  });
});
