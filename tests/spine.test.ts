import { describe, expect, it } from 'vitest';
import {
  formatCompareAdvice,
  formatFirstTouchGreeting,
  formatPortfolioOrientation,
  formatProjectList,
  stripBuilderNameEnvSuffix,
} from '../src/experience/copy.js';
import { generateBuyerProfile, generateBuyerProfiles, profileOpeningMessage } from '../src/eval/personas.js';
import { verifyGrounding } from '../src/compose/render.js';
import { decide } from '../src/turn/decide.js';
import { extractDeterministic } from '../src/nlu/extractors.js';
import { runObjectionGraph } from '../src/graphs/objection.js';
import type { MemoryView } from '../src/types.js';

describe('personas', () => {
  it('generates unique buyer profiles on the fly', () => {
    const a = generateBuyerProfile(1);
    const b = generateBuyerProfile(2);
    expect(a.phone).not.toBe(b.phone);
    expect(a.goal).toBeTruthy();
    expect(a.max_turns).toBeGreaterThan(4);
  });

  it('generates N profiles', () => {
    expect(generateBuyerProfiles(5)).toHaveLength(5);
  });
});

describe('experience copy', () => {
  it('strips env suffix from builder name', () => {
    expect(stripBuilderNameEnvSuffix('Lokations (dev)')).toBe('Lokations');
  });

  it('formats portfolio orientation for plantation catalog', () => {
    const line = formatPortfolioOrientation([
      { project_type: 'managed_plantation_estate', micro_market: 'Sakleshpur' },
      { project_type: 'managed_plantation_estate', micro_market: 'Virajpet' },
    ]);
    expect(line).toMatch(/plantation/i);
    expect(line).toMatch(/Sakleshpur/);
  });

  it('numbered list includes project names and closer', () => {
    const text = formatProjectList({
      projects: [
        { name: 'Ayana', micro_market: 'Sakleshpur', starting_price_display: '₹24.95 L' },
      ],
      filters: { location: 'Sakleshpur', budget: '80 lakh' },
      includeWelcome: true,
      voice: { bot_name: 'Priya', builder_name: 'Lokations' },
    });
    expect(text).toMatch(/Hello! I'm Priya from Lokations/);
    expect(text).toMatch(/1\. \*Ayana\*/);
    expect(text).toMatch(/Which one would you like to explore first\?/);
  });

  it('first-touch greeting uses bot voice', () => {
    const text = formatFirstTouchGreeting(
      { bot_name: 'Priya', builder_name: 'Lokations', bot_signature: '— Team Lokations' },
      'We have managed plantation estates across Sakleshpur, Virajpet.',
    );
    expect(text).toMatch(/Priya from Lokations/);
    expect(text).toMatch(/Team Lokations/);
  });
});

describe('decide', () => {
  const emptyMemory: MemoryView = {
    conversation: {
      id: 'c1', buyer_phone: '+91', builder_id: 'lokations',
      budget: null, bhk: null, location: null, purpose: null,
      focused_project_id: null, shortlist_json: '[]', status: 'new', pending_json: null,
    },
    facts: {},
    pending: null,
    shortlist: [],
    turnIndex: 1,
  };

  it('greeting → template:greeting with catalog', () => {
    const d = decide({ intents: [{ kind: 'greeting' }], slot_writes: [] }, emptyMemory, {
      turnIndex: 1,
      buyerText: 'hi',
    });
    expect(d.composer).toBe('template:greeting');
    expect(d.tool_plan.some((t) => t.name === 'catalog_brief')).toBe(true);
  });

  it('first-turn search → template:welcome_list', () => {
    const mem = { ...emptyMemory, facts: { location: 'Sakleshpur', budget: '80 lakh' } };
    const d = decide({ intents: [{ kind: 'other' }], slot_writes: [] }, mem, {
      turnIndex: 1,
      buyerText: 'Sakleshpur 80 lakh',
    });
    expect(d.composer).toBe('template:welcome_list');
  });

  it('get_project_info → template:detail', () => {
    const mem = {
      ...emptyMemory,
      facts: { project_id: 'ayana' },
    };
    expect(
      decide({ intents: [{ kind: 'get_project_info' }], slot_writes: [] }, mem, {
        turnIndex: 2,
        buyerText: 'tell me about Ayana',
      }).composer,
    ).toBe('template:detail');
  });

  it('book_visit wins over get_project_info on same turn', () => {
    const mem = {
      ...emptyMemory,
      facts: { project_id: 'ayana' },
    };
    const d = decide(
      {
        intents: [{ kind: 'book_visit' }, { kind: 'get_project_info' }],
        slot_writes: [{ slot: 'project_id', value: 'ayana' }],
      },
      mem,
      { turnIndex: 4, buyerText: 'site visit saturday for Ayana' },
    );
    expect(d.composer).toBe('template:visit_confirm');
    expect(d.tool_plan.some((t) => t.name === 'propose_visit')).toBe(true);
  });

  it('compare advice uses shortlist', () => {
    const mem = {
      ...emptyMemory,
      shortlist: ['p1', 'p2'],
      facts: {},
    };
    const d = decide(
      { intents: [{ kind: 'compare_projects' }], slot_writes: [] },
      mem,
      { turnIndex: 3, buyerText: 'which one is better for investment?' },
    );
    expect(d.composer).toBe('template:compare_advice');
    expect(d.tool_plan[0]?.name).toBe('compare_projects');
  });
});

describe('extractors', () => {
  const emptyMemory: MemoryView = {
    conversation: {
      id: 'c1', buyer_phone: '+91', builder_id: 'lokations',
      budget: null, bhk: null, location: null, purpose: null,
      focused_project_id: null, shortlist_json: '[]', status: 'new', pending_json: null,
    },
    facts: {},
    pending: null,
    shortlist: [],
    turnIndex: 1,
  };

  it('extracts project name from "tell me about Ayana"', () => {
    const r = extractDeterministic('tell me about Ayana', emptyMemory);
    expect(r.slot_writes).toContainEqual({ slot: 'project_id', value: 'ayana' });
    expect(r.intents).toContain('get_project_info');
  });

  it('extracts bhk location budget from compact message', () => {
    const r = extractDeterministic('3 BHK Hebbal 80 lakh', emptyMemory);
    expect(r.slot_writes).toContainEqual({ slot: 'location', value: 'Hebbal' });
    expect(r.slot_writes).toContainEqual({ slot: 'budget', value: '80 lakh' });
  });

  it('plantation opening message skips bhk', () => {
    const p = generateBuyerProfile(1, 'lokations');
    expect(profileOpeningMessage(p)).not.toMatch(/BHK/i);
  });

  it('hinglish location budget does not trigger price objection', () => {
    const text = 'Sakleshpur mein 40 lakh budget hai plantation ke liye';
    expect(runObjectionGraph(text, emptyMemory)).toBeNull();
    const r = extractDeterministic(text, emptyMemory);
    expect(r.slot_writes).toContainEqual({ slot: 'location', value: 'Sakleshpur' });
    expect(r.slot_writes).toContainEqual({ slot: 'budget', value: '40 lakh' });
    expect(r.intents).not.toContain('express_objection');
  });

  it('hinglish bhk location budget extracts slots', () => {
    const r = extractDeterministic('Devanahalli mein 2 BHK chahiye budget 80 lakh', emptyMemory);
    expect(r.slot_writes).toContainEqual({ slot: 'location', value: 'Devanahalli' });
    expect(r.slot_writes).toContainEqual({ slot: 'bhk', value: '2 BHK' });
    expect(r.slot_writes).toContainEqual({ slot: 'budget', value: '80 lakh' });
  });
});

describe('compare advice copy', () => {
  it('investment lens cites entry price', () => {
    const text = formatCompareAdvice('which is better for investment?', [
      { name: 'Ayana', starting_price_lakhs: 25, possession_date: 'December 2027', micro_market: 'Sakleshpur' },
      { name: 'Krishnaja Greens', starting_price_lakhs: 39, possession_date: 'Ready to register', micro_market: 'Virajpet' },
    ]);
    expect(text).toMatch(/investment/i);
    expect(text).toMatch(/Ayana/);
    expect(text).toMatch(/Krishnaja Greens/);
  });
});

describe('verifyGrounding', () => {
  it('ignores budget lakh text', () => {
    expect(verifyGrounding('within 80 lakh', []).ok).toBe(true);
  });
});
