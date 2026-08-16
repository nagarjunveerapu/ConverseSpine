/**
 * The five defects that live on the way IN.
 *
 * Live verification against the deployed dev bot said the answering machinery
 * is sound — real RERA numbers, focus held across four topic changes, a
 * brochure that was a real signed PDF. Every failure was upstream of it: the
 * turn was misread, or the brief was never allowed to become a question the
 * book could answer.
 *
 *   F1  a greeting was classified as keyboard smash
 *   F2  a purpose answer was accepted as a place name
 *   F3  an area on its own listed nothing
 *   F4  a budget answer read as an objection and ended the conversation
 *   F5  results from a widened area were listed as an exact-area fit
 *
 * F1–F3 are pure-function tests; F4 and F5 run whole turns because the bug is
 * in what the turn decides, not in what any one function returns.
 */
import { describe, expect, it } from 'vitest';
import { decide } from '../src/engine/phases/discover.js';
import { extractFactsSync } from '../src/engine/facts.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { initState } from '../src/engine/state.js';
import { fakeDeps } from './fakes.js';
import type { ConversationState, Extracted } from '../src/engine/types.js';

const ex = (o: Partial<Extracted> = {}): Extracted => ({ constraints: {}, ...o }) as Extracted;

/** A buyer who has said nothing yet, on the turn after the greeting. */
function cold(over: Partial<ConversationState> = {}): ConversationState {
  const base = initState('c1', 'naya-advisor');
  return { ...base, turnCount: 1, ...over };
}

describe('F1 · a greeting is a knock, not noise', () => {
  // isNonPlaceUtterance answers "could this be a place label?", and a greeting
  // cannot — ATTENTION_FILLER lists hi/hey/hello/yo/hola/namaste, so every one
  // of them read as noise and got "I couldn't make sense of that". Keyboard
  // smash got through the same gate untouched, which is exactly backwards.
  for (const knock of ['hi', 'hey', 'hello', 'namaste']) {
    it(`"${knock}" is answered, not refused`, () => {
      const g = decide(cold(), ex({ isQuestion: false }), knock);
      expect(g.kind).not.toBe('clarify_intent');
    });
  }

  // The control: noise this gate really does catch must still be refused, or
  // the knock guard would have been a hole rather than a fix.
  it('keyboard smash is still refused', () => {
    const g = decide(cold(), ex({ isQuestion: false }), 'asdf asdf');
    expect(g.kind).toBe('clarify_intent');
  });

  // At the TURN level, because the unit tests above were green while the
  // shipped reply was unchanged: there is a third copy of this gate in
  // turn.ts, reached before discover, and it had the same hole. A greeting
  // has to survive the whole path, not just the phase that ends up agreeing.
  it('a whole turn greets a knock and still refuses smash', async () => {
    const deps = fakeDeps();
    const say = (convId: string, text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900001001', channel: 'advisor_web' },
        deps,
      );
    const knock = await say('f1-knock', 'hi');
    expect(knock.reply).not.toMatch(/couldn't make sense/i);
    const smash = await say('f1-smash', 'asdf asdf');
    expect(smash.reply).toMatch(/couldn't make sense/i);
  });
});

describe('F2 · a purpose answer is not a place', () => {
  const st = () => initState('c2', 'naya-advisor');

  // extractLocation's last branch guesses that any short unrecognised utterance
  // is a locality. "to live in", answering the purpose probe, became locality
  // "live" — and OVERWROTE a Whitefield already on file, so the next reply said
  // "I don't have apartments in *live*".
  for (const answer of ['to live in', 'for living in', 'to stay in', 'self use', 'as an investment']) {
    it(`"${answer}" yields no location`, () => {
      expect(extractFactsSync(answer, st()).constraints.location).toBeUndefined();
    });
  }

  // The guard is the grammar of a label plus detectPurpose's own authority —
  // not a deny-list. Real places must be untouched, including the ones that
  // name a purpose in the same breath.
  const places: Array<[string, RegExp]> = [
    ['in whitefield', /whitefield/i],
    ['whitefield', /whitefield/i],
    ['looking in Devanahalli', /devanahalli/i],
    ['Sarjapur Road', /sarjapur/i],
    ['Managed farmland mein invest karna hai. Coorg area preferred', /coorg/i],
    ['3BHK in North Bangalore for the family', /north bangalore/i],
  ];
  for (const [text, want] of places) {
    it(`"${text}" still lands`, () => {
      expect(extractFactsSync(text, st()).constraints.location).toMatch(want);
    });
  }
});

describe('F3 · an area on its own is an answerable brief', () => {
  it('area alone lists projects instead of asking for a budget', () => {
    const s = cold({ discover: { ...initState('c1', 'naya-advisor').discover, oriented: true } });
    const g = decide(s, ex({ constraints: { location: 'Whitefield' } }));
    expect(g.kind).toBe('recommend');
  });

  // Only when it stands alone. A buyer already mid-brief is one slot from a
  // complete answer, and asking for that slot is finishing, not dodging.
  it('area plus a budget still finishes the ladder', () => {
    const s = cold({
      discover: { ...initState('c1', 'naya-advisor').discover, oriented: true },
      constraints: { location: 'Whitefield', budgetMaxInr: 15_000_000 },
    });
    const g = decide(s, ex({ constraints: { location: 'Whitefield', budgetMaxInr: 15_000_000 } }));
    expect(g.kind).toBe('probe');
  });
});

describe('F4 · a first objection with nothing on the board is a misread turn', () => {
  // THESE TWO ARE GUARDS, NOT PROOF — and they say so rather than pretending.
  //
  // The defect was seen live: "under 1.5 cr", answering the budget probe, is
  // stamped speechAct:'object' by the SEMANTIC lane (hasPriceObjectionCue says
  // false), and with no price playbook on the tenant it ended the conversation
  // with "I'll connect you with our sales team". The guard added to
  // fetchObjection refuses that shape.
  //
  // It could not be reproduced in-process. The stamp is applied from a chip
  // resolution inside the extract authority, not from anything a fake port can
  // hand in — overriding deps.semantic and emptying the playbook both leave the
  // turn routed to `orient` long before fetchObjection is reached. So these
  // pass on `main` too. They pin the behaviour we want and will catch a
  // regression; they do NOT demonstrate the fix. That confirmation has to come
  // from dev, replaying the turn that produced it.
  it('a budget answer does not end the conversation', async () => {
    const deps = fakeDeps();
    const convId = 'f4-early-objection';
    const say = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900004001', channel: 'advisor_web' },
        deps,
      );
    await say('hi');
    const r = await say('under 1.5 cr');
    expect(r.reply).not.toMatch(/connect you with|sales team|someone from our team/i);
    expect(r.reply).toMatch(/\?/);
  });

  it('a real objection with a board is still handled as one', async () => {
    const deps = fakeDeps();
    const convId = 'f4-real-objection';
    const say = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900004002', channel: 'advisor_web' },
        deps,
      );
    await say('hi');
    await say('apartment in north bangalore under 1 cr');
    // A board and a budget on file: this buyer really is stalling on price. The
    // guard is scoped to count <= 1 with an empty board and no budget — narrow
    // enough that it cannot swallow a real objection.
    const r = await say('too expensive');
    expect(r.reply).toMatch(/price|cheaper|cost/i);
    expect(r.reply).not.toMatch(/which area|what budget|budget range/i);
  });
});

describe('F5 · a widened area is declared, never listed as a fit', () => {
  it('says it could not match the area when Desk expanded it', async () => {
    const base = fakeDeps();
    // Desk expands a buyer's area into neighbouring localities and hands them
    // back as expandedLocations; the match filter accepts a hit on ANY of them.
    // Good retrieval — and the card came back unmarked, so the reply read as an
    // exact-area fit in an area the project is not in.
    const deps = {
      ...base,
      data: {
        ...base.data,
        async search() {
          return {
            matches: [
              {
                project_id: 'orchards',
                name: 'Brigade Orchards',
                micro_market: 'Sarjapur',
                starting_price_inr: 8_000_000,
                starting_price_display: '₹80 L',
                match_reasons: ['fits'],
                project_type: 'apartment',
              },
            ],
            expandedLocations: ['Sarjapur'],
            recognizedLocations: ['Whitefield'],
          };
        },
      },
    } as typeof base;
    const convId = 'f5-silent-widen';
    const say = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900005001', channel: 'advisor_web' },
        deps,
      );
    await say('hi');
    const r = await say('3 bhk in whitefield under 1.5 cr');
    expect(r.reply).toMatch(/couldn't match that area|couldn't nail that area/i);
  });

  it('stays quiet when every card really is in the asked area', async () => {
    const deps = fakeDeps();
    const convId = 'f5-exact-area';
    const say = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900005002', channel: 'advisor_web' },
        deps,
      );
    await say('hi');
    const r = await say('apartment in north bangalore under 1 cr');
    expect(r.reply).not.toMatch(/couldn't match that area|couldn't nail that area/i);
  });
});
