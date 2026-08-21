/**
 * The bot reads what Desk already handed it.
 *
 * Every wire between the two systems ran ONE way. The engine writes
 * `bhk_preference`, `budget_inr`, `location_pref` and `shortlist_project_ids`
 * into Desk, and had never read one of them back — while `bootstrapContext`
 * fetched the whole conversation row on every cold turn and dropped it.
 *
 * So a buyer who filled Desk's registration form at a site office and tapped
 * the wa.me link met a bot that greeted them as a stranger, and "what's my
 * budget" answered "I don't have your brief on file yet" over a row that held
 * the brief.
 *
 * These tests pin the three rules that make reading it safe: gap-fill only,
 * never widen a value on the way in, and never speak a record that is empty.
 */
import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import { seedFromDeskBrief, resolveShortlistNames } from '../src/engine/desk-brief.js';
import { owesWelcome, welcomeLine } from '../src/engine/welcome.js';
import { fallbackReply } from '../src/engine/compose.js';
import { commitTo, initState } from '../src/engine/state.js';
import { discussedList } from '../src/engine/entity-store.js';
import { INTENT_EFFECTS, applyIntentAuthority } from '../src/engine/turn-routing/intent-authority.js';
import { parseShortlistIds } from '../src/crm/nayadesk-client.js';
import type { ComposeRequest, ConversationState, Extracted } from '../src/engine/types.js';
import type { DeskBrief } from '../src/engine/ports.js';

const cold = (): ConversationState => initState('conv:test', 'brigade-group');

const brief = (over: Partial<DeskBrief> = {}): DeskBrief => ({
  shortlistProjectIds: [],
  selfRegistered: false,
  ...over,
});

describe('seedFromDeskBrief — the record Desk already held', () => {
  it('fills an empty session from the form the buyer filled at the gate', () => {
    const { state, seeded } = seedFromDeskBrief(
      cold(),
      brief({ buyerName: 'Ravi Kumar', bhk: '3 BHK', location: 'Whitefield', purpose: 'self_use' }),
    );
    expect(state.constraints.bhk).toBe('3 BHK');
    expect(state.constraints.location).toBe('Whitefield');
    expect(state.constraints.purpose).toBe('self_use');
    expect(state.buyerName).toBe('Ravi Kumar');
    expect(seeded).toEqual(expect.arrayContaining(['bhk', 'location', 'purpose', 'buyerName']));
  });

  it('never overrules what the buyer said in this session', () => {
    // Desk's row is the OLDER statement by construction — the engine is what
    // writes to it. A buyer who just said "make it 2 BHK" must not be
    // corrected by a form they filled last week.
    const live: ConversationState = {
      ...cold(),
      constraints: { bhk: '2 BHK', location: 'Sarjapur', purpose: 'investment', budgetMaxInr: 9_000_000 },
    };
    const { state, seeded } = seedFromDeskBrief(
      live,
      brief({ bhk: '3 BHK', location: 'Whitefield', purpose: 'self_use', budget: '1.5 Cr' }),
    );
    expect(state.constraints).toEqual(live.constraints);
    expect(seeded).toEqual([]);
  });

  it('parses the budget with the same parser that reads a buyer message', () => {
    // `budget_inr` is a free TEXT column. One parser decides what a number
    // means, or a budget comes to mean two things.
    const { state } = seedFromDeskBrief(cold(), brief({ budget: '80 lakh' }));
    expect(state.constraints.budgetMaxInr).toBe(8_000_000);
  });

  it('drops a budget it cannot read rather than guessing at one', () => {
    // A number the bot invented and then read back as "your budget" is worse
    // than a bot that admits it has no brief.
    const { state, seeded } = seedFromDeskBrief(cold(), brief({ budget: 'call me' }));
    expect(state.constraints.budgetMaxInr).toBeUndefined();
    expect(seeded).not.toContain('budget');
  });

  it('refuses a purpose the column should not have held', () => {
    const { state } = seedFromDeskBrief(cold(), brief({ purpose: 'maybe' }));
    expect(state.constraints.purpose).toBeUndefined();
  });

  it('keeps Desk’s board only when this session has none of its own', () => {
    const withBoard: ConversationState = { ...cold(), shortlistIds: ['p1'] };
    expect(seedFromDeskBrief(withBoard, brief({ shortlistProjectIds: ['p9'] })).state.deskShortlistIds)
      .toBeUndefined();
    expect(seedFromDeskBrief(cold(), brief({ shortlistProjectIds: ['p9'] })).state.deskShortlistIds)
      .toEqual(['p9']);
  });

  it('is a no-op when Desk sent no row', () => {
    const before = cold();
    const { state, seeded } = seedFromDeskBrief(before, undefined);
    expect(state).toBe(before);
    expect(seeded).toEqual([]);
  });
});

describe('the project the buyer was already standing in', () => {
  it('starts the bot focused on the project whose door they registered at', () => {
    const { state, seeded } = seedFromDeskBrief(
      cold(),
      brief({ projectId: 'brigade-oasis', projectName: 'Brigade Oasis', selfRegistered: true }),
    );
    expect(state.phase).toBe('focused');
    expect(state.focus).toEqual({ projectId: 'brigade-oasis', projectName: 'Brigade Oasis' });
    expect(seeded).toContain('project');
  });

  it('will not speak an id as a name', () => {
    // Desk sends the name only when its own has_project gate passes. No name
    // means the lead is still browsing — and "about brigade-oasis —" is not an
    // answer to anybody, so an unnamed id seeds nothing at all.
    const { state, seeded } = seedFromDeskBrief(cold(), brief({ projectId: 'brigade-oasis' }));
    expect(state.phase).toBe('discover');
    expect(state.focus).toBeUndefined();
    expect(seeded).not.toContain('project');
  });

  it('never overrules a focus this session already has', () => {
    const live = commitTo(cold(), 'cornerstone-utopia', 'Cornerstone Utopia');
    const { state, seeded } = seedFromDeskBrief(
      live,
      brief({ projectId: 'brigade-oasis', projectName: 'Brigade Oasis' }),
    );
    expect(state.focus?.projectId).toBe('cornerstone-utopia');
    expect(seeded).not.toContain('project');
  });

  it('records it as discussed, the way an offered project would be', () => {
    // Otherwise the salience and shortlist readers see a focus that nothing
    // in the session ever mentioned.
    const { state } = seedFromDeskBrief(
      cold(),
      brief({ projectId: 'brigade-oasis', projectName: 'Brigade Oasis' }),
    );
    expect(discussedList(state).some((p) => p.projectId === 'brigade-oasis')).toBe(true);
  });

  it('still seeds the brief around it', () => {
    // The door stamps a project AND the form beside it; one must not cost the
    // other.
    const { state, seeded } = seedFromDeskBrief(
      cold(),
      brief({
        projectId: 'brigade-oasis',
        projectName: 'Brigade Oasis',
        bhk: '3 BHK',
        budget: '1.2 Cr',
        buyerName: 'Ravi Kumar',
      }),
    );
    expect(state.focus?.projectName).toBe('Brigade Oasis');
    expect(state.constraints.bhk).toBe('3 BHK');
    expect(state.constraints.budgetMaxInr).toBe(12_000_000);
    expect(state.buyerName).toBe('Ravi Kumar');
    expect(seeded).toEqual(expect.arrayContaining(['project', 'bhk', 'budget', 'buyerName']));
  });
});

describe('parseShortlistIds', () => {
  it('reads the column', () => {
    expect(parseShortlistIds('["a","b"]')).toEqual(['a', 'b']);
  });
  it('treats an unreadable board as an empty one, never a throw', () => {
    // Wrong-but-recoverable beats a turn that dies inside JSON.parse.
    expect(parseShortlistIds('{oops')).toEqual([]);
    expect(parseShortlistIds('')).toEqual([]);
    expect(parseShortlistIds(undefined)).toEqual([]);
  });
});

describe('resolveShortlistNames', () => {
  const names = [
    { projectId: 'p1', name: 'Brigade Cornerstone' },
    { projectId: 'p2', name: 'Brigade Oasis' },
  ];

  it('prefers the live board — it is what the buyer was actually shown', () => {
    const s: ConversationState = { ...cold(), deskShortlistIds: ['p1'] };
    expect(resolveShortlistNames(s, [{ name: 'Sobha Dream' }], names)).toEqual(['Sobha Dream']);
  });

  it('falls back to Desk’s ids, named from the catalog the turn already holds', () => {
    const s: ConversationState = { ...cold(), deskShortlistIds: ['p2', 'p1'] };
    expect(resolveShortlistNames(s, [], names)).toEqual(['Brigade Oasis', 'Brigade Cornerstone']);
  });

  it('drops an id the catalog cannot name rather than speaking the id', () => {
    // "your shortlist: proj_8f21c" is not an answer to anybody.
    const s: ConversationState = { ...cold(), deskShortlistIds: ['p1', 'ghost'] };
    expect(resolveShortlistNames(s, [], names)).toEqual(['Brigade Cornerstone']);
  });
});

describe('the welcome a self-registered buyer had earned', () => {
  const base = {
    channel: 'whatsapp',
    selfRegistered: true as const,
    builderName: 'Brigade Group',
    constraints: {},
  };

  it('is owed once, to a buyer who registered themselves', () => {
    expect(owesWelcome(base)).toBe(true);
    expect(owesWelcome({ ...base, welcomedAt: 1 })).toBe(false);
  });

  it('is not owed to a buyer who arrived any other way', () => {
    // An ordinary WhatsApp buyer gets the greet goal; this line exists only
    // because the self-registered buyer arrived through a different door with
    // a record already made.
    expect(owesWelcome({ ...base, selfRegistered: undefined })).toBe(false);
  });

  it('is not owed on the advisor app, or to a buyer we just forgot', () => {
    expect(owesWelcome({ ...base, channel: 'advisor_web' })).toBe(false);
    expect(owesWelcome({ ...base, erased: true })).toBe(false);
  });

  it('reads back what the form held, and names the official number', () => {
    const line = welcomeLine({
      ...base,
      buyerName: 'Ravi',
      focusProjectName: 'Brigade Cornerstone',
      constraints: { bhk: '3 BHK', purpose: 'self_use' },
    });
    expect(line).toContain('Ravi');
    expect(line).toContain('Brigade Group');
    // A buyer who scanned a QR at a gate has no way of knowing whose WhatsApp
    // number they just opened.
    expect(line).toMatch(/official number/);
    expect(line).toContain('Brigade Cornerstone');
    expect(line).toContain('3 BHK');
    // The buyer's words, not the column's.
    expect(line).toContain('to live in');
    expect(line).not.toContain('self_use');
  });

  it('says hello and nothing more when the form carried nothing', () => {
    // "We've got your requirements" over an empty row is a false affirmative.
    const line = welcomeLine(base);
    expect(line).toMatch(/official number/);
    expect(line).not.toMatch(/filled in/);
  });
});

describe('recall_constraints — the read-back that had no shortlist in it', () => {
  const req = (context: Partial<ComposeRequest['context']>): ComposeRequest => ({
    goal: { kind: 'recall_constraints' },
    evidence: { tools: [] },
    context: { constraints: {}, alreadyShownSameSet: false, builderName: 'Brigade', ...context },
  });

  it('names the projects on the board', () => {
    const reply = fallbackReply(req({
      constraints: { budgetMaxInr: 12_000_000 },
      shortlistNames: ['Brigade Cornerstone', 'Brigade Oasis'],
    }));
    expect(reply).toContain('Brigade Cornerstone');
    expect(reply).toContain('Brigade Oasis');
  });

  it('answers a shortlist question when the shortlist is all we hold', () => {
    // Before: an empty `constraints` meant "I don't have your brief on file
    // yet" — said to a buyer with three projects saved.
    const reply = fallbackReply(req({ shortlistNames: ['Brigade Oasis'] }));
    expect(reply).not.toMatch(/don't have/i);
    expect(reply).toContain('Brigade Oasis');
  });

  it('reads purpose back in the buyer’s words, not the column’s', () => {
    const reply = fallbackReply(req({ constraints: { purpose: 'investment' } }));
    expect(reply).toContain('as an investment');
    expect(reply).not.toContain('investment,'); // not the bare column value
    expect(reply).not.toContain('self_use');
  });

  it('says where it came from when the buyer typed it on Desk’s form', () => {
    const reply = fallbackReply(req({
      constraints: { bhk: '3 BHK' },
      selfRegistered: true,
    }));
    expect(reply).toMatch(/site office/);
  });

  it('still admits an empty brief', () => {
    expect(fallbackReply(req({}))).toMatch(/don't have/i);
  });
});

describe('recall_profile — the kind the corpus never had', () => {
  const ex = (over: Partial<Extracted> = {}): Extracted =>
    ({ constraints: {}, ...over }) as Extracted;
  const routing = (top_kind: string) =>
    ({ routing: 'defer', bind: { miss_reason: 'unmapped_kind', top_kind } }) as never;

  it('is an owned effect, wired to the path that already existed', () => {
    expect(INTENT_EFFECTS['recall_profile']).toEqual({ recallConstraints: true });
  });

  it('fills the flag when the embedding is confident and nobody else owns it', () => {
    const out = applyIntentAuthority(ex(), routing('recall_profile'), 'what do you know about me');
    expect(out.ex.recallConstraints).toBe(true);
    expect(out.wrote).toContain('recallConstraints');
  });

  it('never displaces an answer the engine can actually give', () => {
    // "what's the price of my shortlist" is a price question that says "my".
    const out = applyIntentAuthority(ex({ askTopic: 'price' }), routing('recall_profile'), 'price of my shortlist');
    expect(out.ex.recallConstraints).toBeUndefined();
  });

  it('leaves the visit-recall path alone', () => {
    // "when is my visit" owns its own answer; the two are exclusive upstream
    // and stay exclusive here.
    const out = applyIntentAuthority(ex({ recall: true }), routing('recall_profile'), 'when is my visit');
    expect(out.ex.recallConstraints).toBeUndefined();
  });

  it('does nothing when extraction already decided', () => {
    // The regex owns a narrow slice ("what was my budget"). Where it fires,
    // this must be a no-op — two authorities on one decision is the design
    // this module exists to avoid.
    const already = ex({ recallConstraints: true });
    const out = applyIntentAuthority(already, routing('recall_profile'), 'what was my budget');
    expect(out.wrote).not.toContain('recallConstraints');
  });

  it('leaves the privacy-policy question to somebody else', () => {
    // "what personal data do you collect" is `about_data` — a policy question.
    // Answering it with this buyer's budget is a different wrong answer.
    expect(INTENT_EFFECTS['about_data']).toBeUndefined();
  });
});

/**
 * ── The wire, not the units ──────────────────────────────────────────────
 *
 * Everything above this line is green and has been since the day it was
 * written, and none of it drives a turn. `seedFromDeskBrief` folds a brief
 * correctly when handed one; `welcomeLine` reads a record back correctly when
 * handed one. Neither test says that a buyer sending "Hi" to the deployed bot
 * gets a welcome with her project in it — that needs the two to meet inside
 * `runEngineTurn`, and nothing here made them.
 *
 * It matters because the fake said no. `fakeData().bootstrapContext` returns
 * `{ recentMessages: [], rejectedProjectIds: [], turnIndex: 1 }` — no
 * `deskBrief`, ever. So every end-to-end test in this suite has been running
 * the empty-record branch and passing, which is the same shape as three copies
 * of a gate where only one of them runs.
 */
describe('a real turn — the welcome a buyer actually receives', () => {
  const RAMYA = {
    buyerName: 'Ramya',
    bhk: '3 BHK',
    purpose: 'self_use',
    projectId: 'ayana',
    projectName: 'Ayana',
    shortlistProjectIds: [],
    selfRegistered: true,
  } satisfies DeskBrief;

  function harness(deskBrief: DeskBrief | undefined, convId: string) {
    const deps = fakeDeps();
    deps.data.bootstrapContext = async () => ({
      recentMessages: [],
      rejectedProjectIds: [],
      turnIndex: 1,
      ...(deskBrief ? { deskBrief } : {}),
    });
    return (text: string) =>
      runEngineTurn(
        { convId, builderId: 'brigade-group', text, buyerPhone: '+919591400615', channel: 'whatsapp' },
        deps,
      );
  }

  it('names the project she registered at, on her first message', async () => {
    const turn = harness(RAMYA, 'wire-welcome-full');
    const out = await turn('Hi');

    // The greeting and the official-number line were never the problem — they
    // are what she GOT. The read-back is the part that went missing.
    expect(out.welcome, 'a self-registered buyer is owed a welcome').toBeTruthy();
    expect(out.welcome).toContain('Ramya');
    expect(out.welcome).toContain('Ayana');
    expect(out.welcome).toContain('3 BHK');
    expect(out.welcome).toContain('to live in');
  });

  it('starts her focused on that project rather than asking which one', async () => {
    const turn = harness(RAMYA, 'wire-welcome-focus');
    const out = await turn('Hi');
    expect(out.state.focus?.projectId, 'she walked through that gate').toBe('ayana');
  });

  it('still says only hello when Desk held nothing but the registration', async () => {
    // Not a weaker assertion — the honest branch has to survive the fix, or
    // "we have your requirements" starts appearing over empty rows.
    const turn = harness(
      { shortlistProjectIds: [], selfRegistered: true },
      'wire-welcome-empty',
    );
    const out = await turn('Hi');
    expect(out.welcome).toBeTruthy();
    expect(out.welcome).not.toContain('filled in at the site office');
  });

  it('greets a walk-in the agent recorded as a stranger — no welcome at all', async () => {
    const turn = harness({ ...RAMYA, selfRegistered: false }, 'wire-welcome-notself');
    const out = await turn('Hi');
    expect(out.welcome).toBeUndefined();
  });
});

/**
 * ── The returning buyer ───────────────────────────────────────────────────
 *
 * `bootstrapContext` is guarded by `state.turnCount === 0` and commented
 * "only on cold conversations (first turn)". That is true of the SESSION. It
 * is not true of the buyer.
 *
 * `handleChat` (worker/routes.ts) resolves the Spine `convId` by calling
 * Desk's `upsertLead`, and Desk's `conversations` table is
 * `UNIQUE(builder_id, buyer_phone)` — one row per person per tenant, forever.
 * That id is also the Durable Object key (`state:${convId}` in store-kv.ts).
 * So the session state is not per-conversation; it is per-person-per-tenant
 * and it never expires.
 *
 * Which means `turnCount === 0` happens exactly once in a buyer's life. Every
 * later thing Desk learns about them — a registration at a second project, an
 * agent qualifying the lead on the walk-in sheet, a budget typed into the
 * dossier — is written to a row the bot will never read again.
 *
 * This is the founder's reported failure: she registered, opened WhatsApp,
 * said "Hi", and got a greeting with no read-back — on a number that had
 * talked to the bot three days earlier.
 */
describe('what Desk learns after the buyer\u2019s first ever message', () => {
  const LATER = {
    buyerName: 'Ramya',
    bhk: '3 BHK',
    purpose: 'self_use',
    projectId: 'ayana',
    projectName: 'Ayana',
    shortlistProjectIds: [],
    selfRegistered: true,
  } satisfies DeskBrief;

  function returning(convId: string) {
    const deps = fakeDeps();
    let brief: DeskBrief | undefined;
    let looks = 0;
    deps.data.bootstrapContext = async () => {
      looks += 1;
      return {
        recentMessages: [],
        rejectedProjectIds: [],
        turnIndex: 1,
        ...(brief ? { deskBrief: brief } : {}),
      };
    };
    const turn = (text: string) =>
      runEngineTurn(
        {
          convId,
          builderId: 'brigade-group',
          text,
          buyerPhone: '+919591400615',
          channel: 'whatsapp',
        },
        deps,
      );
    return {
      deps,
      turn,
      looks: () => looks,
      setBrief: (b: DeskBrief | undefined) => {
        brief = b;
      },
      /** What Desk's lead invalidate does to the session, and nothing more. */
      async deskPushedLeadInvalidate() {
        const st = await deps.store.load(convId);
        if (!st) throw new Error('no session to refresh');
        const { deskBriefAt: _dropped, ...rest } = st;
        await deps.store.save(rest);
      },
    };
  }

  it('is read by a session that had never looked — every row that predates the form', async () => {
    // The real shape of the reported failure. Her number had talked to the bot
    // three days earlier, so `turnCount === 0` was long spent; the session had
    // no `deskBriefAt` because nothing had ever asked the question.
    const h = returning('legacy-session');
    h.deps.store.save({
      ...cold(),
      convId: 'legacy-session',
      builderId: 'brigade-group',
      turnCount: 4,
      ndConversationId: 'nd:+919591400615',
    });
    h.setBrief(LATER);

    const out = await h.turn('Hi');
    expect(out.welcome, 'she registered — she is owed the welcome').toBeTruthy();
    expect(out.welcome).toContain('Ayana');
    expect(out.state.focus?.projectId).toBe('ayana');
  });

  it('is read again when Desk says a person changed the row', async () => {
    const h = returning('agent-qualified');
    await h.turn('hi');
    expect(h.looks(), 'turn 0 looks').toBe(1);

    // Turn two, nothing pushed: the row is not re-read. This is the property
    // that keeps a Desk round trip off every message the bot handles.
    await h.turn('what about north bangalore');
    expect(h.looks(), 'no push, no second look').toBe(1);

    // Now an agent claims the walk-in and qualifies her, and Desk pushes.
    h.setBrief(LATER);
    await h.deskPushedLeadInvalidate();

    const out = await h.turn('Hi');
    expect(h.looks(), 'the push is what makes it look again').toBe(2);
    expect(out.state.focus?.projectId).toBe('ayana');
  });

  it('does not re-fetch an empty row on every turn', async () => {
    // "Have we looked?" — not "did we find anything?". Desk holding nothing is
    // an answer, and re-asking it each turn would put a round trip on the
    // critical path of every message.
    const h = returning('empty-row');
    await h.turn('hi');
    await h.turn('coorg');
    await h.turn('50 lakhs');
    expect(h.looks()).toBe(1);
  });

  it('looks again after a reset, rather than orphaning the row for good', async () => {
    // `/reset` returns before the bootstrap with `turnCount: 1`, so under the
    // old condition a buyer who typed it could never be read from Desk again.
    // `freshSession` drops `deskBriefAt`, so the question reopens.
    const h = returning('after-reset');
    await h.turn('hi');
    h.setBrief(LATER);
    await h.turn('/reset');
    const out = await h.turn('Hi');
    expect(h.looks()).toBe(2);
    expect(out.state.focus?.projectId).toBe('ayana');
  });
});
