import { describe, expect, it } from 'vitest';
import { resolveCatalogNameHit } from '../src/engine/facts.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * AB-6 / W8 — a project NAMED from a cold start must resolve against the FULL
 * catalog, not just the (empty) session shortlist. Before this, "is Brigade Oasis
 * a plotted development?" extracted propertyType=plot and re-searched, dumping an
 * unrelated Mysore list instead of committing to Brigade Oasis.
 */
const CATALOG = [
  { projectId: 'oasis', name: 'Brigade Oasis' },
  { projectId: 'northridge', name: 'Brigade Northridge Neo' },
  { projectId: 'desire', name: 'Desire Spaces' },
  { projectId: 'eldorado', name: 'Brigade Eldorado' },
  { projectId: 'meadows', name: 'Brigade Meadows' },
];

describe('AB-6 — resolveCatalogNameHit', () => {
  it('resolves a distinctive token in a cold question', () => {
    expect(resolveCatalogNameHit('is Brigade Oasis a plotted development?', CATALOG)?.projectId).toBe('oasis');
    expect(resolveCatalogNameHit('is Brigade Northridge Neo plotted?', CATALOG)?.projectId).toBe('northridge');
    expect(resolveCatalogNameHit('what plot sizes does Desire Spaces have?', CATALOG)?.projectId).toBe('desire');
  });

  it('returns null when no catalog name is present (a pure search)', () => {
    expect(resolveCatalogNameHit('plotted developments in Whitefield', CATALOG)).toBeNull();
    expect(resolveCatalogNameHit('cheap apartments under 50 lakhs', CATALOG)).toBeNull();
    expect(resolveCatalogNameHit('show me villas', CATALOG)).toBeNull();
  });

  it('returns null on ambiguity — never guesses which project', () => {
    // both Oasis and Eldorado are Brigade projects, but only the distinctive token
    // disambiguates; a bare "brigade" hits neither distinctively.
    expect(resolveCatalogNameHit('tell me about brigade projects', CATALOG)).toBeNull();
    // two distinct names named at once → ambiguous
    expect(resolveCatalogNameHit('compare Oasis and Eldorado', CATALOG)).toBeNull();
  });
});

describe('AB-6 — cold-named project commits, not re-searches', () => {
  it('commits focus to the named project instead of dumping a list', async () => {
    // Clarks Exotica is a villa in the fake catalog; a cold "is Clarks Exotica a
    // villa?" must commit to it, not re-search on the type word.
    const deps = fakeDeps();
    const r = await runEngineTurn(
      { convId: 'ab6-cold', builderId: 'lokations', text: 'is Clarks Exotica a villa project?', buyerPhone: '+919999999981' },
      deps,
    );
    expect(r.debug.goal.kind).not.toBe('recommend');
    expect(r.reply).toMatch(/Clarks/);
    expect(r.reply).not.toMatch(/Here's what fits/);
  });

  it('a pure area search still recommends (no false commit)', async () => {
    const deps = fakeDeps();
    const r = await runEngineTurn(
      { convId: 'ab6-search', builderId: 'lokations', text: 'apartments in Sarjapur', buyerPhone: '+919999999982' },
      deps,
    );
    expect(r.debug.goal.kind).toBe('recommend');
  });
});
