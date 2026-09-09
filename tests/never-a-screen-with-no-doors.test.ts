/**
 * A turn we could not read still hands the buyer a door.
 *
 * `runEngineTurn` packs a WhatsApp interactive on every return but one: the
 * early unsupported/unknown-request bail. That return sent text alone, so the
 * buyer who typed something we failed to parse got "I couldn't make sense of
 * that. … please share your locality, budget, BHK?" with nothing to tap — the
 * only way forward was to guess better words.
 *
 * A builder with ONE project felt it worst, and that is the case under test.
 * There is nothing to narrow, so the brief questions are a form for a filter
 * that cannot filter; and the single row that would have ended the turn is
 * exactly the row the bail withheld. Seen live on the Lokations line: "Show me
 * your projects" answered with a request for a locality and no project list,
 * on a builder whose whole book is Earth Aroma.
 *
 * The invariant: on a failed turn the reply carries what the builder actually
 * has — the book (or the focused project's own file menu), never an invented
 * option — and a one-project book is named rather than filtered.
 */

import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import type { EngineDeps } from '../src/engine/ports.js';
import { fakeDeps } from './fakes.js';

/** Embedder fires and misses — the one shape that reaches unknown_request. */
function missHarness(book: Array<{ projectId: string; name: string }>): EngineDeps {
  const deps = fakeDeps();
  deps.failureRouting = true;
  deps.failureSearch = true;
  deps.waProjectFirst = true;
  const inner = deps.data.catalog.bind(deps.data);
  deps.data.catalog = async (builderId: string) => {
    const base = await inner(builderId);
    return {
      ...base,
      projectNames: book,
      total: book.length,
      sample: book.map((p) => ({ name: p.name, startingPriceDisplay: '' })),
    };
  };
  deps.routingEnv = {
    SIL_EMBED_FIRST: 'true',
    FAILURE_ROUTING: 'true',
    AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    // A real vector hit that lands under tau: embed_fired true, miss below_tau.
    INTENT_VECTORS: {
      query: async () => ({
        matches: [{ id: 'fixture-miss', score: 0.11, metadata: { intent_kind: 'about_ai' } }],
      }),
    },
  } as unknown as NonNullable<EngineDeps['routingEnv']>;
  return deps;
}

const ONE = [{ projectId: 'earth-aroma', name: 'Earth Aroma' }];
const MANY = [
  { projectId: 'earth-aroma', name: 'Earth Aroma' },
  { projectId: 'ayana', name: 'Ayana' },
  { projectId: 'vanam', name: 'Vanam' },
];

/** Unparseable on purpose — no FAQ key, no answer requirement, no nudge. */
const NOISE = 'zzxq wibble frob';

describe('a turn we could not read still hands the buyer a door', () => {
  it('a one-project builder gets that project, not a brief form', async () => {
    const deps = missHarness(ONE);
    const result = await runEngineTurn(
      { threadId: 'doors-one', builderId: 'lokations', text: NOISE, channel: 'whatsapp' },
      deps,
    );

    // The words: name the project, never ask to narrow a book of one.
    expect(result.reply).toContain('Earth Aroma');
    expect(result.reply).not.toMatch(/locality, budget/i);

    // The doors: an interactive payload, cut from the builder's own book.
    expect(result.whatsappInteractive, 'no interactive on the failed turn').toBeDefined();
    // A list, not the size/budget probe: the row IS the project, and the tap
    // opens its file. (Lists carry rows, so whatsappActions — a buttons-only
    // projection — is legitimately empty here.)
    expect(result.whatsappInteractive?.kind).toBe('list');
    expect(JSON.stringify(result.whatsappInteractive)).toContain('Earth Aroma');
  });

  it('a many-project builder keeps the honest probe, and it now arrives', async () => {
    const deps = missHarness(MANY);
    const result = await runEngineTurn(
      { threadId: 'doors-many', builderId: 'lokations', text: NOISE, channel: 'whatsapp' },
      deps,
    );
    // Unchanged copy and unchanged doors — size and budget DO cut a book of
    // three. What changed is that they reach the buyer at all.
    expect(result.whatsappInteractive?.kind).toBe('buttons');
    const rendered = JSON.stringify(result.whatsappInteractive);
    expect(rendered).toContain('wa.menu.projects');
    expect(result.whatsappActions?.length ?? 0).toBe(3);
  });

  it('offers nothing the builder does not have', async () => {
    const deps = missHarness(ONE);
    const result = await runEngineTurn(
      { threadId: 'doors-honest', builderId: 'lokations', text: NOISE, channel: 'whatsapp' },
      deps,
    );
    const rendered = JSON.stringify(result.whatsappInteractive);
    // Ayana and Vanam are on the fake's own catalogue but not on THIS book.
    expect(rendered).not.toContain('Ayana');
    expect(rendered).not.toContain('Vanam');
  });

  it('advisor_web is unchanged — the pack is a WhatsApp payload', async () => {
    const deps = missHarness(ONE);
    const result = await runEngineTurn(
      { threadId: 'doors-web', builderId: 'lokations', text: NOISE, channel: 'advisor_web' },
      deps,
    );
    expect(result.whatsappInteractive).toBeUndefined();
    expect(result.reply).toContain('Earth Aroma');
  });
});
