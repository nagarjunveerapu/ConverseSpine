import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyTurnRoutingRules } from '../src/engine/turn-routing/classify.js';
import { mapIntentToRouting } from '../src/engine/turn-routing/embedder-map.js';
import { buildRoutingQuery } from '../src/engine/turn-routing/build-query.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(__dir, 'fixtures/rti-3-routing-golden.json'), 'utf8'),
) as Array<{
  id: string;
  input: TurnRoutingInput;
  expect_routing: string;
  expect_topic?: string;
  intent_kind?: string;
  score?: number;
}>;

describe('RTI-3B routing golden', () => {
  for (const row of golden) {
    it(`${row.id}: ${row.expect_routing}`, () => {
      if (row.intent_kind != null && row.score != null) {
        const result = mapIntentToRouting(row.intent_kind, row.score, row.input);
        expect(result?.routing).toBe(row.expect_routing);
        if (row.expect_topic) expect(result?.answer_topic).toBe(row.expect_topic);
        return;
      }
      const result = classifyTurnRoutingRules(row.input);
      expect(result.routing).toBe(row.expect_routing);
      if (row.expect_topic) expect(result.answer_topic).toBe(row.expect_topic);
    });
  }

  it('buildRoutingQuery is the raw buyer text — same embedding space as the corpus', () => {
    // The corpus (mined + Desk-promoted rows) embeds raw phrasings; a feature
    // prefix here diluted short asks below τ against their own taught vectors.
    const q = buildRoutingQuery({
      text: '  what about Eldorado?  ',
      builder_id: 'brigade-group',
      phase: 'visit',
      visit: { booked_count: 1, queued_count: 1, awaiting_confirm: false },
      named_project_ids: ['eldorado'],
    });
    expect(q).toBe('what about Eldorado?');
  });
});

describe('RTI-3B discover bare what-about defers to embedder', () => {
  it('rules do not force visit without visit context', () => {
    const result = classifyTurnRoutingRules({
      text: 'what about Eldorado?',
      builder_id: 'brigade-group',
      phase: 'discover',
      named_project_ids: ['eldorado'],
    });
    expect(result.routing).toBe('defer');
  });

  it('embedder maps get_project_info to answer in discover', () => {
    const result = mapIntentToRouting('get_project_info', 0.82, {
      text: 'what about Eldorado?',
      builder_id: 'brigade-group',
      phase: 'discover',
      named_project_ids: ['eldorado'],
    });
    expect(result?.routing).toBe('answer_on_project');
    expect(result?.confidence).toBe('embedder');
  });
});
