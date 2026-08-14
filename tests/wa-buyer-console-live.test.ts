import { describe, expect, it } from 'vitest';
import {
  splitProjectStamp,
  WA_MENU_CHOOSE,
  WA_MENU_PROJECTS,
  WA_MONEY_TOTAL,
  WA_NODE_TIME,
  WA_NODE_TRUST,
  WA_PROJECT_STAMP,
} from '../src/channel/wa-pack.js';
import { markFacetSeen, projectSeenFacets, recordEntities } from '../src/engine/entity-store.js';
import { commitTo, initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeData, fakeDeps, projectDetailFor } from './fakes.js';

/**
 * The founder's 14-Aug walk, asserted turn by turn — the regression this whole
 * arc exists for. The old build answered the pick in the old voice with a bare
 * Price button, and the Price tap reprinted the board's price. The console
 * answers the pick with the buyer's fit, one menu titled off the mock, money
 * rows that mean money (total cost / EMI), and rows that stop being offered
 * once they were delivered.
 */

function harness(convId: string) {
  const deps = { ...fakeDeps(), waProjectFirst: true };
  const turn = (text: string, actionId?: string) =>
    runEngineTurn(
      {
        convId,
        builderId: 'lokations',
        text,
        buyerPhone: '+919999991180',
        channel: 'whatsapp',
        ...(actionId ? { action_id: actionId } : {}),
      },
      deps,
    );
  return { deps, turn };
}

function listRows(out: Awaited<ReturnType<typeof runEngineTurn>>) {
  const packed = out.whatsappInteractive;
  if (!packed || packed.kind !== 'list') return undefined;
  return packed.sections[0]!.rows;
}

describe('founder walk 14 Aug — the console answers the pick', () => {
  it('brief taps → pick → fit card + one console menu, never bare buttons', async () => {
    const { turn } = harness('wa-founder-walk');

    const hi = await turn('Hi');
    expect(hi.whatsappInteractive?.kind).toBe('buttons');

    const choose = await turn('Help me choose', WA_MENU_CHOOSE);
    expect(choose.whatsappInteractive?.kind).toBe('list');

    const size = await turn('2 BHK', 'wa.bhk.2_bhk');
    expect(size.whatsappInteractive?.kind).toBe('list');

    const budget = await turn('Under ₹80L', 'wa.budget.u_8000000');
    expect(budget.whatsappInteractive?.kind).toBe('list');

    // The pick — Bug A's turn. The reply is the buyer's fit ending on the
    // console question, and the chrome is the ONE menu, not three buttons.
    const pick = await turn('Brigade Cornerstone', 'wa.pick.cornerstone');
    expect(pick.reply).toContain('*Brigade Cornerstone* — your fit:');
    expect(pick.reply).toContain('2 BHK');
    expect(pick.reply.trim().endsWith('What do you want to check?')).toBe(true);

    const rows = listRows(pick);
    expect(rows).toBeDefined();
    expect(pick.whatsappInteractive!.kind === 'list' && pick.whatsappInteractive!.button).toBe('More');
    const aids = rows!.map((r) => splitProjectStamp(r.id).aid);
    // Money means the mock's money — cut to the size the buyer already gave.
    const total = rows!.find((r) => splitProjectStamp(r.id).aid === WA_MONEY_TOTAL)!;
    expect(total.title).toBe('Total cost — 2 BHK');
    expect(splitProjectStamp(total.id).projectId).toBe('cornerstone');
    // EMI, the payment plan and the banks live one level down, inside Money.
    expect(aids).toContain('wa.node.money');
    expect(aids).toContain(WA_NODE_TRUST);
    // The founder's flagged rows are dead: no bare Price, no size re-ask.
    expect(rows!.some((r) => r.title === 'Price')).toBe(false);
    expect(aids.some((a) => a.startsWith('wa.money.bhk.'))).toBe(false);
    expect(rows![rows!.length - 1]!.id).toBe(WA_MENU_PROJECTS);
  });

  it('the Total-cost tap reaches the landed cost, and the row drops from that same menu', async () => {
    const { turn } = harness('wa-founder-walk-total');
    await turn('Help me choose', WA_MENU_CHOOSE);
    await turn('2 BHK', 'wa.bhk.2_bhk');
    await turn('Under ₹80L', 'wa.budget.u_8000000');
    await turn('Brigade Cornerstone', 'wa.pick.cornerstone');

    const total = await turn('Total cost — 2 BHK', `${WA_MONEY_TOTAL}${WA_PROJECT_STAMP}cornerstone`);
    // The board's price reprint is the bug; the cost sheet is the fix.
    expect(total.reply).toContain('Stamp duty');
    expect(projectSeenFacets(total.state, 'cornerstone')).toContain('total');

    // The tap was a money row, so the buyer stays inside Money — the answered
    // row is gone from it, and the way back is on the same screen.
    const rows = listRows(total)!;
    const aids = rows.map((r) => splitProjectStamp(r.id).aid);
    expect(aids).not.toContain(WA_MONEY_TOTAL);
    expect(aids).toContain('wa.money.emi');
    expect(aids).toContain('wa.back.file');
  });

  it('a single-config project offers All-in cost and prices its only unit', async () => {
    const { turn } = harness('wa-single-config');
    const opened = await turn('tell me about Ayana');
    const rows = listRows(opened)!;
    const allIn = rows.find((r) => splitProjectStamp(r.id).aid === WA_MONEY_TOTAL);
    expect(allIn?.title).toBe('All-in cost');

    const total = await turn('All-in cost', `${WA_MONEY_TOTAL}${WA_PROJECT_STAMP}ayana`);
    // No size was ever named — the entry unit is fetched and priced (Defect E).
    expect(total.reply).toContain('Stamp duty');
    expect(projectSeenFacets(total.state, 'ayana')).toContain('total');
  });

  it('a pick with the size open leads with the price-free ladder, then one size row after', async () => {
    const { turn } = harness('wa-sizes-open');
    // A plain board pick, no size given — the ladder leads the console.
    const opened = await turn('Brigade Eldorado', 'wa.pick.eldorado');
    expect(opened.reply.trim().endsWith('What do you want to check?')).toBe(true);
    const rows = listRows(opened)!;
    const aids = rows.map((r) => splitProjectStamp(r.id).aid);
    expect(aids).toContain('wa.money.bhk.2');
    expect(aids).toContain('wa.money.bhk.3');
    for (const r of rows) expect(r.description ?? '').not.toContain('₹');

    // A node tap later: the ladder folds to ONE size row, and the delivered
    // trust screen stops being offered on the very same turn's menu.
    const trust = await turn('Trust & legal', `${WA_NODE_TRUST}${WA_PROJECT_STAMP}eldorado`);
    expect(trust.reply).toMatch(/RERA|PRM\/KA/i);
    // The tap opened Trust itself: its own topics, and the way back.
    const trustRows = listRows(trust)!;
    const trustAids = trustRows.map((r) => splitProjectStamp(r.id).aid);
    expect(trustAids).not.toContain(WA_NODE_TRUST);
    expect(trustAids).toContain('wa.sub.trust.rera');
    expect(trustAids).toContain('wa.back.file');

    // Back to the file, and the sizes question is where it belongs: The unit.
    const back = await turn('← Back to the file', `wa.back.file${WA_PROJECT_STAMP}eldorado`);
    const backAids = listRows(back)!.map((r) => splitProjectStamp(r.id).aid);
    expect(backAids).toContain('wa.node.unit');

    const sizes = await turn('Sizes & options', `wa.console.sizes${WA_PROJECT_STAMP}eldorado`);
    expect(sizes.reply).toContain('2 BHK');
    expect(sizes.reply).toContain('3 BHK');
  });

  it('a delivered brochure is marked seen on the ledger', async () => {
    const { turn } = harness('wa-brochure-seen');
    await turn('tell me about Brigade Cornerstone');
    const media = await turn('Brochure', 'answer_media');
    expect(projectSeenFacets(media.state, 'cornerstone')).toContain('brochure');
  });

  it('all seen → "you\'ve been through the full file", said once', async () => {
    const deps = { ...fakeDeps(), waProjectFirst: true };
    const convId = 'wa-all-seen';
    const detail = {
      ...projectDetailFor('cornerstone')!,
      configurations: [
        { unitType: '2 BHK', priceDisplay: '₹52 L', priceMinInr: 5_200_000, sizeDisplay: '1050-1180 sqft' },
        { unitType: '3 BHK', priceDisplay: '₹62 L', priceMinInr: 6_240_000, sizeDisplay: '1400-1550 sqft' },
      ],
    };
    let s = commitTo(initState(convId, 'lokations'), 'cornerstone', 'Brigade Cornerstone');
    s = recordEntities(s, [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }], 'discussed', 1);
    s = { ...s, constraints: { ...s.constraints, bhk: '2 BHK' } };
    s = { ...s, projectCache: { cornerstone: detail } };
    // The buyer has toured everything except possession.
    for (const f of ['total', 'emi', 'trust', 'place'] as const) {
      s = markFacetSeen(s, 'cornerstone', f);
    }
    await deps.store.save(s);

    const turn = (text: string, actionId?: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919999991181', channel: 'whatsapp', ...(actionId ? { action_id: actionId } : {}) },
        deps,
      );

    // Possession delivers the last unseen row — the console says "you're done".
    const time = await turn('Possession', `${WA_NODE_TIME}${WA_PROJECT_STAMP}cornerstone`);
    expect(time.reply).toContain('the full file on *Brigade Cornerstone*');
    // The screen keeps the file — sections are places, and a place you have
    // stood in is still a place. What ends is the offering of new answers.
    // The tap opened Time, so this screen is Time's: whatever it can still
    // answer, then the way back and the standing act. Never a dead end.
    const rows = listRows(time)!;
    expect(rows.map((r) => splitProjectStamp(r.id).aid)).toContain('wa.back.file');
    expect(rows.map((r) => r.id)).toContain('visit_book');

    // Said once: the next turn keeps the screen but not the closing line.
    const again = await turn('Possession', `${WA_NODE_TIME}${WA_PROJECT_STAMP}cornerstone`);
    expect(again.reply).not.toContain('the full file on');
  });
});

/**
 * "See I don't see other options even now" (founder, 14 Aug, with screenshots).
 * The console drew money rows and the two standing doors — never Trust & legal,
 * Location, Possession. The board search prefetches every match, and a match
 * that isn't Desk's focus yields an IDENTITY-ONLY shell: a name and units, no
 * legal facts. The commit read that shell straight out of projectCache, so the
 * file rows had nothing to gate on — and promoting it (units + a name were
 * enough to strip the flag) made every later hydrate treat the shell as a hit,
 * keeping the file missing for the rest of the conversation.
 */
describe('an identity-only shell never becomes the project file', () => {
  function shellHarness(convId: string) {
    const data = fakeData();
    const deps = { ...fakeDeps(), data, waProjectFirst: true };
    const turn = (text: string, actionId?: string) =>
      runEngineTurn(
        {
          convId,
          builderId: 'lokations',
          text,
          buyerPhone: '+919999991181',
          channel: 'whatsapp',
          ...(actionId ? { action_id: actionId } : {}),
        },
        deps,
      );
    return { data, turn };
  }

  it('the pick re-fetches past a prefetched shell, so the file rows draw', async () => {
    const { data, turn } = shellHarness('wa-shell-pick');
    // Desk's conversationContext is focus-scoped, so a prefetched match that
    // isn't the focus yields a shell. This is the ordinary board turn.
    data.fail.projectDetail = 'absent';
    await turn('Help me choose', WA_MENU_CHOOSE);
    await turn('2 BHK', 'wa.bhk.2_bhk');
    const board = await turn('Under ₹80L', 'wa.budget.u_8000000');
    expect(board.state.projectCache?.['krishnaja']?.identityOnly).toBe(true);
    expect(board.state.projectCache?.['krishnaja']?.reraNumber).toBeUndefined();

    // The detail is reachable on the pick — the console must go and get it
    // instead of dressing the shell up as the project file.
    delete data.fail.projectDetail;
    const pick = await turn('Krishnaja', 'wa.pick.krishnaja');
    const aids = listRows(pick)!.map((r) => splitProjectStamp(r.id).aid);
    expect(aids).toContain(WA_NODE_TRUST);
    expect(aids).toContain(WA_NODE_TIME);
    // The founder's screenshot was exactly four rows: two money, two doors.
    expect(aids.length).toBeGreaterThan(4);
    expect(pick.state.projectCache?.['krishnaja']?.reraNumber).toBeTruthy();
  });

  it('a shell that survives the pick is never promoted into the cache', async () => {
    const { data, turn } = shellHarness('wa-shell-poison');
    data.fail.projectDetail = 'absent';
    await turn('Help me choose', WA_MENU_CHOOSE);
    await turn('2 BHK', 'wa.bhk.2_bhk');
    await turn('Under ₹80L', 'wa.budget.u_8000000');
    const pick = await turn('Krishnaja', 'wa.pick.krishnaja');
    const cached = pick.state.projectCache?.['krishnaja'];
    expect(cached?.reraNumber).toBeUndefined();
    expect(cached?.identityOnly).toBe(true);
  });
});
