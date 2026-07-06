import { describe, expect, it } from 'vitest';
import { kvStore } from '../src/engine/store-kv.js';
import { initState } from '../src/engine/state.js';

describe('kvStore dev memory', () => {
  it('persists state across store instances in local dev', async () => {
    const a = kvStore(undefined);
    const b = kvStore(undefined);
    const s = initState('advisor:persist-test', 'naya-advisor');
    s.turnCount = 2;
    await a.save(s);
    expect(await b.load('advisor:persist-test')).toMatchObject({ turnCount: 2 });
  });
});
