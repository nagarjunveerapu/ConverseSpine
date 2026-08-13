/**
 * The recovery label set had exactly one objection and no asks, so every
 * unbound message the closed extractors abstained on was labelled
 * `objection_price` — and the objection branch DELETES the price ask. On the
 * live Brigade book that sent five conversations to "I'll connect you with our
 * sales team": "kitne ka hai?", "eshtu rate ide?", "1400 sqft for a 3 bhk is too
 * small", "only one car park is not enough", "I can pay 60000 per month".
 */
import { describe, expect, it } from 'vitest';
import { applyIntentRecovery } from '../src/engine/intent-recovery.js';

const bare = { constraints: {} };

describe('intent recovery — asking is not objecting', () => {
  it('binds a price question to the price ask, with no objection', () => {
    const ex = applyIntentRecovery(bare, { confidence: 'llm', labels: ['ask_price'] });

    expect(ex.askTopic).toBe('price');
    expect(ex.askTopics).toContain('price');
    expect(ex.objection).toBeUndefined();
    expect(ex.speechAct).toBe('answer');
  });

  it('routes a unit complaint to the configurations, an amenity one to amenities', () => {
    expect(applyIntentRecovery(bare, { confidence: 'llm', labels: ['ask_config'] }).askTopic).toBe(
      'availability',
    );
    expect(applyIntentRecovery(bare, { confidence: 'llm', labels: ['ask_amenity'] }).askTopic).toBe(
      'amenities',
    );
    expect(applyIntentRecovery(bare, { confidence: 'llm', labels: ['ask_emi'] }).askTopic).toBe('emi');
  });

  it('keeps every asked topic when the model returns more than one', () => {
    const ex = applyIntentRecovery(bare, {
      confidence: 'llm',
      labels: ['ask_price', 'ask_emi'],
    });

    expect(ex.askTopics).toEqual(['price', 'emi']);
  });

  it('still objects when the buyer is actually complaining about the money', () => {
    const ex = applyIntentRecovery(bare, {
      confidence: 'llm',
      labels: ['ask_price', 'objection_price'],
    });

    // A real price objection outranks the ask — the objection path owns the turn.
    expect(ex.objection).toBe(true);
    expect(ex.objectionTopic).toBe('price');
  });

  it('never outranks a topic the closed extractors already found', () => {
    const ex = applyIntentRecovery(
      { constraints: {}, askTopic: 'possession', askTopics: ['possession'] },
      { confidence: 'llm', labels: ['ask_config'] },
    );

    // "when is possession?" also reads as a question about the unit. The topic
    // the extractor was sure about stands alone — a second one turns the reply
    // into a multi-topic answer that leads with the size list.
    expect(ex.askTopic).toBe('possession');
    expect(ex.askTopics).toEqual(['possession']);
  });

  it('leaves the extraction alone when the model abstains', () => {
    expect(applyIntentRecovery(bare, { confidence: 'abstain', labels: [] })).toEqual(bare);
  });
});
