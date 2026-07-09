import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps, fakeCrm } from './fakes.js';
import { resolveCompareProjectIds } from '../src/engine/compare_resolve.js';
import { detectFocusedSwitchIntent } from '../src/engine/project_switch.js';
import { extractFactsSync, extractLocation, parseBudgetToInr, detectTopics, wantsImplicitProjectPick, isBudgetFitQuestion, isBudgetPickQuestion } from '../src/engine/facts.js';
import { initState, resolvePick } from '../src/engine/state.js';
import * as discover from '../src/engine/phases/discover.js';
import { fallbackReply, buildComposeRequest } from '../src/engine/compose.js';
import { checkGrounding } from '../src/engine/grounding.js';

describe('ConverseEngine facts', () => {
  it('parses budget without triggering objection', () => {
    const s = initState('c1', 'lokations');
    const ex = extractFactsSync('Sakleshpur mein 40 lakh budget hai plantation ke liye', s);
    expect(ex.constraints.location).toBe('Sakleshpur');
    expect(ex.constraints.budgetMaxInr).toBe(4_000_000);
  });

  it('extracts location from comma form "coorg, 50 Lakhs"', () => {
    expect(extractLocation('coorg, 50 Lakhs')).toBe('coorg');
  });

  it('extracts mysore from "looking for properties in mysore"', () => {
    expect(extractLocation('looking for properties in mysore')).toBe('mysore');
  });

  it('extracts full micro_market from brief composed line', () => {
    expect(
      extractLocation('Not sure yet, budget ₹40–50L, in Aerospace Park / Devanahalli Corridor'),
    ).toBe('Aerospace Park / Devanahalli Corridor');
  });

  it('does not treat advisor brief chips as locations', () => {
    expect(extractLocation('Investment')).toBeUndefined();
    expect(extractLocation('Wealth preservation')).toBeUndefined();
    expect(extractLocation('Whitefield')).toBe('Whitefield');
    expect(extractLocation('Tuesday')).toBeUndefined();
    expect(extractLocation('Tuesday morning')).toBeUndefined();
  });

  it('detects legal topic from title question', () => {
    expect(detectTopics('Is the title clear?')).toContain('legal');
  });

  it('legal question after shortlist commits instead of re-recommending', () => {
    const s = {
      ...initState('c1', 'lokations'),
      turnCount: 3,
      discover: {
        ...initState('c1', 'lokations').discover,
        oriented: true,
        lastOffered: [{ projectId: 'meadows', name: 'Brigade Meadows' }],
      },
      constraints: { budgetMaxInr: 10_000_000, bhk: '3 BHK', location: 'North Bangalore' },
    };
    const ex = extractFactsSync('Is the title clear?', s);
    const goal = discover.decide(s, ex);
    expect(goal).toMatchObject({ kind: 'commit', followUp: 'legal' });
  });

  it('"show me the options" triggers wantsMore', () => {
    const s = initState('c1', 'lokations');
    const ex = extractFactsSync('show me the otpions', s);
    expect(ex.wantsMore).toBe(true);
  });

  it('parses compact bhk location budget', () => {
    expect(parseBudgetToInr('3 BHK Whitefield 1.2 cr')?.max).toBe(12_000_000);
  });

  it('compare topic detected', () => {
    const ex = extractFactsSync('compare both projects', initState('c1', 'lokations'));
    expect(ex.askTopic).toBe('compare');
  });

  it('detects multi-intent pricing and legal', () => {
    expect(detectTopics('pricing and legal')).toEqual(['price', 'legal']);
  });

  it('detects location topic', () => {
    expect(detectTopics('location details')).toEqual(['location']);
    expect(detectTopics('location?')).toEqual(['location']);
  });

  it('detects banks and EC as legal topics', () => {
    expect(detectTopics('what banks approved?')).toContain('legal');
    expect(detectTopics('is EC clear?')).toContain('legal');
  });

  it('detects price break-up', () => {
    expect(detectTopics('price break-up')).toEqual(['price']);
  });

  it('detects budget feasibility questions', () => {
    expect(isBudgetFitQuestion('so do they come in 20L?')).toBe(true);
    expect(isBudgetFitQuestion('budget is around 20 Lakhs')).toBe(false);
    expect(isBudgetFitQuestion('anything under 50 lakh in Devanahalli?')).toBe(true);
    expect(isBudgetFitQuestion('Which fits my budget best?')).toBe(false);
  });

  it('detects budget pick questions among shortlist', () => {
    expect(isBudgetPickQuestion('Which fits my budget best?')).toBe(true);
    const s = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'a', name: 'Brigade Eldorado' },
          { projectId: 'b', name: 'Brigade Orchards' },
        ],
      },
    };
    const ex = extractFactsSync('Which fits my budget best?', s);
    expect(ex.budgetPickQuestion).toBe(true);
    expect(discover.decide(s, ex)).toMatchObject({ kind: 'answer', topic: 'compare' });
  });

  it('budget fit question re-searches instead of committing to project detail', () => {
    const s = {
      ...initState('c1', 'lokations'),
      turnCount: 5,
      discover: {
        ...initState('c1', 'lokations').discover,
        oriented: true,
        lastOffered: [
          { projectId: 'eldorado', name: 'Brigade Eldorado', startingPriceDisplay: '₹31 L' },
          { projectId: 'cornerstone', name: 'Brigade Cornerstone', startingPriceDisplay: '₹33 L' },
        ],
      },
      constraints: {
        budgetMaxInr: 2_000_000,
        location: 'Devanahalli',
        propertyType: 'apartment',
      },
    };
    const ex = extractFactsSync('so do they come in 20L?', s);
    expect(ex.budgetFitQuestion).toBe(true);
    expect(discover.decide(s, ex)).toMatchObject({ kind: 'recommend' });
  });

  it('filters search matches by budget and location', () => {
    const raw = [
      {
        projectId: 'neo',
        name: 'Brigade Northridge Neo',
        microMarket: 'Yelahanka',
        startingPriceInr: 1_800_000,
        startingPriceDisplay: '₹18 L',
        matchReasons: [],
      },
      {
        projectId: 'eldorado',
        name: 'Brigade Eldorado',
        microMarket: 'Aerospace Park / Devanahalli Corridor',
        startingPriceInr: 3_100_000,
        startingPriceDisplay: '₹31 L',
        matchReasons: [],
      },
    ];
    expect(
      discover.filterSearchMatches(raw, { budgetMaxInr: 2_000_000, location: 'Devanahalli' }, []),
    ).toHaveLength(1);
    expect(
      discover.filterSearchMatches(raw, { budgetMaxInr: 2_000_000, location: 'Devanahalli' }, [])[0]?.name,
    ).toBe('Brigade Northridge Neo');
    const gap = discover.buildBudgetNoFitEvidence(
      { budgetMaxInr: 2_000_000, location: 'Devanahalli' },
      raw,
      [],
    );
    expect(gap?.budgetGap?.closestName).toBe('Brigade Eldorado');
    expect(gap?.noMatch?.reasoning).toMatch(/Nothing in Devanahalli starts within/i);
  });

  it('builds constraint gap evidence for missing BHK at budget', () => {
    const gap = discover.buildConstraintGapEvidence(
      { bhk: '4 BHK', budgetMaxInr: 5_000_000, location: 'Aerospace Park / Devanahalli Corridor' },
      [
        {
          projectId: 'eldorado',
          name: 'Brigade Eldorado',
          microMarket: 'Aerospace Park / Devanahalli Corridor',
          startingPriceInr: 3_100_000,
          startingPriceDisplay: '₹31 L',
          matchReasons: [],
        },
      ],
      [],
    );
    expect(gap?.constraintGap?.bhk).toBe('4 BHK');
    expect(gap?.noMatch?.reasoning).toMatch(/No \*4 BHK\*/);
  });

  it('implicit pick on "details on the project" when one offered', () => {
    const offered = [{ projectId: 'ayana', name: 'Ayana' }];
    expect(wantsImplicitProjectPick('give me details on the project', offered)).toBe(true);
    const s = {
      ...initState('c1', 'lokations'),
      discover: { ...initState('c1', 'lokations').discover, lastOffered: offered },
    };
    const ex = { ...extractFactsSync('give me details on the project', s), transition: 'want_details' as const };
    expect(resolvePick(ex, offered)?.name).toBe('Ayana');
  });
});

describe('ConverseEngine discover', () => {
  it('first turn greets', () => {
    const s = initState('c1', 'lokations');
    const goal = discover.decide(s, extractFactsSync('hi', s));
    expect(goal.kind).toBe('greet');
  });

  it('compare routes to answer when IDs resolved', () => {
    const s = {
      ...initState('c1', 'lokations'),
      turnCount: 2,
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
    };
    const ex = {
      ...extractFactsSync('compare both projects', s),
      compareProjectIds: ['ayana', 'krishnaja'],
    };
    const goal = discover.decide(s, ex);
    expect(goal).toMatchObject({ kind: 'answer', topic: 'compare' });
  });

  it('constraints trigger recommend', () => {
    const s = {
      ...initState('c1', 'lokations'),
      turnCount: 2,
      discover: { ...initState('c1', 'lokations').discover, oriented: true },
      constraints: { budgetMaxInr: 8_000_000, location: 'Sakleshpur' },
    };
    const goal = discover.decide(s, extractFactsSync('show options', s));
    expect(goal.kind).toBe('recommend');
  });
});

describe('ConverseEngine compose fallback', () => {
  it('recommend lists matches from evidence only', () => {
    const req = buildComposeRequest(
      { kind: 'recommend' },
      {
        tools: ['search'],
        matches: [
          {
            projectId: 'p1',
            name: 'Ayana',
            microMarket: 'Sakleshpur',
            startingPriceInr: 2_495_000,
            startingPriceDisplay: '₹24.95 L',
            matchReasons: [],
          },
        ],
      },
      { constraints: {}, alreadyShownSameSet: false, builderName: 'Lokations' },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/Ayana/);
    expect(reply).toMatch(/24\.95 L/);
  });

  it('multi-intent pricing + legal in one reply', () => {
    const req = buildComposeRequest(
      { kind: 'answer', topic: 'price', topics: ['price', 'legal'], projectId: 'ayana' },
      {
        tools: ['pricing', 'detail'],
        pricing: {
          projectName: 'Ayana',
          components: [{ label: 'Base land price', value: '₹499/sqft (launch)' }],
        },
        detail: {
          projectId: 'ayana',
          name: 'Ayana',
          microMarket: 'Sakleshpur',
          reraNumber: 'PRM/KA/RERA/1251/446/2024',
          possession: 'December 2027',
        },
      },
      { constraints: {}, alreadyShownSameSet: false, builderName: 'Lokations' },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/Pricing/i);
    expect(reply).toMatch(/499\/sqft/);
    expect(reply).toMatch(/RERA/);
  });

  it('legal answer uses RERA from evidence', () => {
    const req = buildComposeRequest(
      { kind: 'answer', topic: 'legal', projectId: 'ayana' },
      {
        tools: ['detail'],
        detail: {
          projectId: 'ayana',
          name: 'Ayana',
          microMarket: 'Sakleshpur',
          reraNumber: 'KA/RR/123/2024',
          possession: 'December 2027',
        },
      },
      { constraints: {}, alreadyShownSameSet: false, builderName: 'Lokations' },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/RERA/);
    expect(reply).toMatch(/KA\/RR\/123\/2024/);
  });
});

describe('Coorg funnel (deterministic)', () => {
  it('recommend → compare both → compare by name → plantation refine', async () => {
    const deps = fakeDeps();
    const input = (text: string) =>
      runEngineTurn(
        { convId: 'coorg-funnel', builderId: 'lokations', text, buyerPhone: '+919999999999' },
        deps,
      );

    await input('Hi');
    const t2 = await input('coorg, 50 Lakhs');
    expect(t2.debug.goal.kind).toBe('recommend');
    expect(t2.reply).toMatch(/Ayana|Krishnaja/i);
    expect(t2.state.discover.lastOffered.length).toBeGreaterThanOrEqual(2);

    const t3 = await input('compare both projects');
    expect(t3.debug.goal).toMatchObject({ kind: 'answer', topic: 'compare' });
    expect(t3.reply).toMatch(/Ayana/i);
    expect(t3.reply).toMatch(/Krishnaja/i);
    expect(t3.state.discover.lastOffered.length).toBeGreaterThanOrEqual(2);

    const t4 = await input('compare ayana and krishnaja greens');
    expect(t4.debug.goal).toMatchObject({ kind: 'answer', topic: 'compare' });

    const t5 = await input('i am looking for plantation');
    expect(t5.state.constraints.propertyType).toBe('plantation');
    expect(t5.state.constraints.location?.toLowerCase()).toMatch(/coorg/);
    expect(t5.state.constraints.budgetMaxInr).toBe(5_000_000);
    expect(['recommend', 'advance']).toContain(t5.debug.goal.kind);
    expect(t5.state.discover.lastOffered.length).toBeGreaterThan(0);
    expect(t5.reply).toMatch(/Ayana|Krishnaja/i);
  });

  it('resolveCompareProjectIds binds "both" to last bot listing', () => {
    const s = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
        recentMessages: [
          {
            role: 'bot' as const,
            text: "Here's what fits: *Ayana* in Sakleshpur; *Krishnaja Greens* in Virajpet.",
            atMs: 1,
          },
        ],
      },
    };
    const ex = extractFactsSync('compare both projects', s);
    const ids = resolveCompareProjectIds('compare both projects', { ...ex, askTopic: 'compare' }, s);
    expect(ids).toEqual(['ayana', 'krishnaja']);
  });
});

describe('Focused project switch detection', () => {
  it('detects Krishnaja via namedProjects while focused on Ayana', () => {
    const s = {
      ...initState('c1', 'lokations'),
      phase: 'focused' as const,
      focus: { projectId: 'ayana', projectName: 'Ayana' },
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [{ projectId: 'ayana', name: 'Ayana' }],
      },
    };
    const ex = {
      constraints: {},
      transition: 'none' as const,
      namedProjects: [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }],
    };
    const intent = detectFocusedSwitchIntent('What about Krishnaja Greens?', ex, s);
    expect(intent).toMatchObject({ commit: { projectId: 'krishnaja', name: 'Krishnaja Greens' } });
  });
});

describe('Focused project switch', () => {
  it('names Krishnaja while focused on Ayana → commit + overview on Krishnaja', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'switch-test', builderId: 'lokations', text, buyerPhone: '+919999999997' },
        deps,
      );

    await say('hi');
    await say('plantation in sakleshpur');
    await say('give me details on the project');
    expect((await deps.store.load('switch-test'))?.focus?.projectId).toBe('ayana');

    const t4 = await say('What about Krishnaja Greens?');
    expect(t4.debug.goal).toMatchObject({ kind: 'answer', topic: 'overview' });
    expect(t4.state.focus?.projectId).toBe('krishnaja');
    expect(t4.reply).toMatch(/Krishnaja/i);
    expect(t4.reply).not.toMatch(/Great choice.*Ayana/i);
    expect((deps.crm as ReturnType<typeof fakeCrm>).calls).toContain('commit:krishnaja');
  });

  it('Krishnaja pricing while focused on Ayana switches and answers price', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'switch-price', builderId: 'lokations', text, buyerPhone: '+919999999996' },
        deps,
      );

    await say('hi');
    await say('plantation in sakleshpur');
    await say('give me details on the project');
    const t4 = await say('Krishnaja Greens pricing');
    expect(t4.state.focus?.projectId).toBe('krishnaja');
    expect(t4.debug.goal).toMatchObject({ kind: 'answer', topic: 'price' });
    expect(t4.reply).toMatch(/Krishnaja|₹39 L/i);
  });
});

describe('Post-visit ack', () => {
  it('okay/thanks after visit booked stays warm — no handoff', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'visit-ack', builderId: 'lokations', text, buyerPhone: '+919999999995' },
        deps,
      );

    await say('hi');
    await say('plantation in sakleshpur');
    await say('give me details on the project');
    await say('book a visit Saturday morning');
    await say('yes');

    const afterBook = await deps.store.load('visit-ack');
    expect(afterBook?.phase).toBe('focused');
    expect(afterBook?.postVisitAckPending).toBe(true);

    const tAck = await say('okay');
    expect(tAck.debug.goal.kind).toBe('warm_ack');
    expect(tAck.state.phase).toBe('focused');
    expect(tAck.reply).toMatch(/all set/i);
    expect(tAck.reply).not.toMatch(/team reach out/i);
  });
});

describe('Mysuru funnel fixes', () => {
  it('details pick commits with overview in same turn', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'mysuru-details', builderId: 'lokations', text, buyerPhone: '+919999999993' },
        deps,
      );

    await say('hi');
    await say('show me plantation projects');
    const t3 = await say('give me more details on ayana');
    expect(t3.state.focus?.projectId).toBe('ayana');
    expect(t3.debug.goal).toMatchObject({ kind: 'answer', topic: 'overview' });
    expect(t3.reply).toMatch(/Ayana/i);
    expect(t3.reply).not.toMatch(/Great choice.*Want pricing/i);
  });

  it('pricing avoids duplicate From prefix', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'mysuru-price', builderId: 'lokations', text, buyerPhone: '+919999999992' },
        deps,
      );

    await say('hi');
    await say('show me plantation projects');
    await say('give me details on ayana');
    const t4 = await say('pricing');
    expect(t4.reply).toMatch(/Starting from ₹24\.95 L/i);
    expect(t4.reply).not.toMatch(/From From/i);
  });

  it('answers apartment vs plot question from project type', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'mysuru-type', builderId: 'lokations', text, buyerPhone: '+919999999991' },
        deps,
      );

    await say('hi');
    await say('show me plantation projects');
    await say('give me details on ayana');
    const t4 = await say('is this an apartment or plots');
    expect(t4.debug.goal).toMatchObject({ kind: 'answer', topic: 'property_type' });
    expect(t4.reply).toMatch(/managed plantation estate/i);
    expect(t4.reply).not.toMatch(/possession Ready/i);
  });
});

describe('Brochure on commit turn', () => {
  it('share brochure of ayana → commit + media in one turn', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'brochure-commit', builderId: 'lokations', text, buyerPhone: '+919999999994' },
        deps,
      );

    await say('hi');
    await say('show me plantation projects');
    const t3 = await say('share me the brochure of ayana');
    expect(t3.state.focus?.projectId).toBe('ayana');
    expect(t3.debug.goal).toMatchObject({ kind: 'answer', topic: 'media' });
    expect(t3.reply).toMatch(/brochure|https/i);
    expect(t3.reply).not.toMatch(/Great choice.*Want pricing/i);
  });
});

describe('Sakleshpur funnel (deterministic)', () => {
  it('details on project → commit → pricing and legal multi-intent', async () => {
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn(
        { convId: 'sakleshpur', builderId: 'lokations', text, buyerPhone: '+919999999998' },
        deps,
      );

    await say('hi');
    await say('looking for plantation properties in sakleshpur');

    const t3 = await say('give me details on the project');
    expect(t3.debug.goal).toMatchObject({ kind: 'answer', topic: 'overview' });
    expect(t3.state.phase).toBe('focused');

    await say('50L');
    await say('want full details on Ayana');

    const t6 = await say('pricing and legal');
    expect(t6.debug.goal).toMatchObject({ kind: 'answer', topic: 'price' });
    expect(t6.debug.goal.topics).toEqual(['price', 'legal']);
    expect(t6.reply).toMatch(/Pricing/i);
    expect(t6.reply).toMatch(/RERA/);

    const t7 = await say('legal status');
    expect(t7.debug.goal).toMatchObject({ kind: 'answer', topic: 'legal' });
    expect(t7.reply).toMatch(/RERA/);

    const t8 = await say('location details');
    expect(t8.debug.goal).toMatchObject({ kind: 'answer', topic: 'location' });
    expect(t8.reply).toMatch(/Sakleshpur/i);
    expect(t8.reply).toMatch(/Bangalore|connectivity|Western Ghats/i);
  });
});
