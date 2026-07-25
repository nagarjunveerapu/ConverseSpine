/**
 * PR-1 defect probes — "the buyer named this project" must mean one project.
 *
 * These are SEAM tests. Every defect below sits between two modules that each
 * have passing property suites of their own (`name-evidence`, `project-switch`,
 * `discover-implicit-pick`, `compare-intent`). None of those suites can see
 * these, because none of them owns the boundary.
 *
 * Fixture is the REAL naya-advisor catalog, read from naya-db-dev (21 rows).
 * The two facts that matter:
 *   - `Krishnaja Greens` and `Viva Greens` share the token `greens`
 *   - ten rows share the token `brigade`
 *
 * Root cause under test: "distinctive token" is computed as *drop the first
 * token, keep tokens ≥5 characters* — a guess about name shape made without
 * looking at the catalog. `Viva` is 4 characters, so `Viva Greens` loses its
 * actual distinguishing word and inherits the shared one.
 */
import { describe, expect, it } from 'vitest';
import { filterNamedProjectsByEvidence } from '../../src/engine/project_switch.js';
import { resolveProjectReferences } from '../../src/engine/project_references.js';
import { runEngineTurn } from '../../src/engine/turn.js';
import { fakeDeps } from '../fakes.js';
import type { OfferedProject } from '../../src/engine/types.js';

/** Verbatim from `SELECT name FROM projects WHERE builder_id='naya-advisor'`. */
const CATALOG_NAMES = [
  'Ayana',
  'Brigade Atmosphere',
  'Brigade Buena Vista',
  'Brigade Calista',
  'Brigade Cornerstone',
  'Brigade Cornerstone Utopia',
  'Brigade Eldorado',
  'Brigade Meadows',
  'Brigade Northridge Neo',
  'Brigade Oasis',
  'Brigade Orchards',
  'Brigade Sanctuary',
  'Century Breeze',
  'Clarks Exotica',
  'Desire Spaces',
  'Earth Aroma',
  'Hillside County',
  'Krishnaja Greens',
  'My-Sooru',
  'Vanam',
  'Viva Greens',
] as const;

const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const proj = (name: string): OfferedProject => ({ projectId: id(name), name });
const CATALOG = CATALOG_NAMES.map((n) => ({ project_id: id(n), name: n }));

const KRISHNAJA = proj('Krishnaja Greens');
const VIVA = proj('Viva Greens');
const ELDORADO = proj('Brigade Eldorado');
const CORNERSTONE = proj('Brigade Cornerstone');
const UTOPIA = proj('Brigade Cornerstone Utopia');

describe('a word shared by two projects names neither of them', () => {
  it('"I want green spaces" is a preference, not a project name', () => {
    // The floor is a VETO layer — its whole job is killing an embedder proposal
    // the buyer never typed. Here it endorses one: `greens` scores `full`.
    expect(
      filterNamedProjectsByEvidence('I want green spaces', [KRISHNAJA, VIVA], []),
    ).toEqual([]);
  });

  it('"show me the greens" does not pick a winner between two Greens projects', () => {
    expect(
      resolveProjectReferences('show me the greens', [], CATALOG).map((p) => p.name),
    ).toEqual([]);
  });

  it('but the distinguishing word still names its project (no regression)', () => {
    // Pinned independently at name-evidence.test.ts — the fix must not break it.
    expect(
      filterNamedProjectsByEvidence('and krishnaja greens?', [KRISHNAJA, VIVA], []),
    ).toEqual([KRISHNAJA]);
  });

  it('a 4-character distinguishing word is still a name ("Viva" is not noise)', () => {
    // PASSES TODAY, and only by accident: the ≥5-char filter deletes `Viva`, so
    // Viva Greens is judged on `greens` alone (full) while Krishnaja Greens needs
    // both its tokens (partial) — full outranks partial, so the right project
    // wins for the wrong reason. Pinned so the fix keeps the OUTCOME while
    // replacing the mechanism.
    expect(
      filterNamedProjectsByEvidence('tell me about viva greens', [KRISHNAJA, VIVA], []),
    ).toEqual([VIVA]);
  });
});

describe('a builder brand is not a project', () => {
  it('"is Brigade a reliable builder" does not name an off-board Brigade project', () => {
    // Ten catalog rows start with Brigade. The precision floor admits any of
    // them on the brand token alone — including one that is not on the board.
    expect(
      filterNamedProjectsByEvidence(
        'is Brigade a reliable builder',
        [ELDORADO],
        [CORNERSTONE],
      ),
    ).toEqual([]);
  });

  it('agrees with resolveCatalogNameHit, which already refuses the bare brand', () => {
    // name-from-scratch.test.ts pins `'tell me about brigade projects' → null`.
    // Two resolvers, one input, opposite answers is the defect.
    expect(
      resolveProjectReferences('tell me about brigade projects', [], CATALOG),
    ).toEqual([]);
  });
});

describe('superset disambiguation applies to the buyer, not only to the bot', () => {
  it('"cornerstone" is the Cornerstone, not both Cornerstones', () => {
    // disambiguateStrictSupersets is called from projectsInListing (bot replies)
    // and NOT from the direct buyer-text path at project_references.ts:70.
    expect(
      resolveProjectReferences('tell me about cornerstone', [], CATALOG).map((p) => p.name),
    ).toEqual(['Brigade Cornerstone']);
  });

  it('naming the superset explicitly still selects it', () => {
    expect(
      resolveProjectReferences('cornerstone utopia details', [], CATALOG).map((p) => p.name),
    ).toEqual(['Brigade Cornerstone Utopia']);
  });

  it('the floor already gets this right — the two must not disagree', () => {
    // Judged against the CATALOG, as the turn pipeline does. With only these two
    // names in scope, `brigade` is shared by both and ordered by ⊆, so it stays
    // name-bearing and "cornerstone" alone reads as partial for both. Ten
    // Brigade rows make `brigade` ambiguous, which is the truth of this tenant.
    expect(
      filterNamedProjectsByEvidence(
        'tell me about cornerstone',
        [UTOPIA],
        [CORNERSTONE],
        CATALOG_NAMES.map((name) => ({ name })),
      ),
    ).toEqual([CORNERSTONE]);
  });
});

/**
 * THE SEAM.
 *
 * Two shipped fixes, each correct alone, each with a passing property suite:
 *   1. the precision floor passes a proposal whose name the buyer "typed"
 *   2. name-beats-filters: a single high-confidence hit MEANS the buyer named it,
 *      so commit rather than search (discover-implicit-pick.test.ts)
 *
 * Compose them on a preference sentence and the bot opens a project nobody named.
 * This is the case the catalog is genuinely required for: the embedder proposes
 * its top hit ALONE, so there is no sibling in the call to reveal that `greens`
 * is shared.
 */
describe('seam: a preference word must not commit a project', () => {
  it('"I want green spaces" does not open Krishnaja Greens', async () => {
    const deps = fakeDeps();
    // The embedder does its job: it proposes a semantically plausible top hit.
    // Nothing downstream may treat that as the buyer having named it.
    deps.semantic = {
      async enrich(_text, _builderId, ex) {
        return { ...ex, namedProjects: [KRISHNAJA] };
      },
    };
    // Model the tenant the defect lives in. The default fake catalog holds one
    // Greens project, where `greens` genuinely does pick it out — so the shared
    // token only exists on naya-advisor, and that is the catalog the floor must
    // be judging against.
    //
    // HONEST LIMIT: with a single-Greens catalog this turn would still commit.
    // Distinctiveness fixes "which project does this word name"; it does not
    // decide "is this sentence naming a project at all". That is a separate gap.
    const baseCatalog = deps.data.catalog.bind(deps.data);
    deps.data.catalog = async (builderId) => ({
      ...(await baseCatalog(builderId)),
      projectNames: CATALOG.map((c) => ({ projectId: c.project_id, name: c.name })),
    });

    const r = await runEngineTurn(
      {
        convId: 'seam-green-spaces',
        builderId: 'naya-advisor',
        text: 'I want green spaces',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(r.state.focus).toBeUndefined();
    expect(r.debug.goal.kind).not.toBe('commit');
    expect(r.reply).not.toMatch(/Krishnaja/i);
  });

  it('naming it outright still opens it', async () => {
    const deps = fakeDeps();
    deps.semantic = {
      async enrich(_text, _builderId, ex) {
        return { ...ex, namedProjects: [KRISHNAJA] };
      },
    };

    const r = await runEngineTurn(
      {
        convId: 'seam-krishnaja-named',
        builderId: 'naya-advisor',
        text: 'tell me about Krishnaja Greens',
        channel: 'advisor_web',
      },
      deps,
    );

    // Assert on the NAME, not the id: the fake resolves against its own catalog
    // (`krishnaja`), and this control is about which project the buyer reached,
    // not about which fixture minted the id.
    expect(r.state.focus?.projectName).toMatch(/Krishnaja/i);
  });
});

/**
 * THE HOLE THE SCENARIOS FOUND.
 *
 * The floor is the only layer that resolves a name against the catalog, and it
 * early-returns when the extractor proposed nothing:
 *
 *     if (!named.length) return [...named];
 *
 * So the catalog rescue added for "tell me about cornerstone" only fires when
 * the embedder proposed SOMETHING that was merely partial. When it proposes
 * nothing at all, a project the buyer named in full is simply lost. Live on dev:
 *
 *     "Buena Vista instead"    -> offered Brigade Sanctuary + Cornerstone Utopia
 *     "anyway Eldorado price"  -> "I can't promise or negotiate a discount"
 *
 * Both name a real catalog project. Both are exactly what this PR is named after.
 */
describe('a fully-named project survives an empty proposal', () => {
  const CATALOG_REFS = CATALOG_NAMES.map((name) => ({ projectId: id(name), name }));

  it('names Brigade Buena Vista when the extractor proposed nothing', () => {
    expect(
      filterNamedProjectsByEvidence('Buena Vista instead', [], [], CATALOG_REFS).map((p) => p.name),
    ).toEqual(['Brigade Buena Vista']);
  });

  it('names Brigade Eldorado from a facet ask with no proposal', () => {
    expect(
      filterNamedProjectsByEvidence('anyway Eldorado price', [], [], CATALOG_REFS).map((p) => p.name),
    ).toEqual(['Brigade Eldorado']);
  });

  it('still invents nothing when the text names no project', () => {
    expect(filterNamedProjectsByEvidence('what is the price', [], [], CATALOG_REFS)).toEqual([]);
    expect(filterNamedProjectsByEvidence('I want green spaces', [], [], CATALOG_REFS)).toEqual([]);
    expect(filterNamedProjectsByEvidence('is Brigade a reliable builder', [], [], CATALOG_REFS)).toEqual([]);
  });

  it('a PARTIAL name on an empty proposal is not enough', () => {
    // "cornerstone" is partial for Utopia; with nothing proposed and no board,
    // surfacing a guess would be worse than surfacing nothing.
    const out = filterNamedProjectsByEvidence('tell me about cornerstone', [], [], CATALOG_REFS);
    expect(out.map((p) => p.name)).toEqual(['Brigade Cornerstone']);
  });
});
