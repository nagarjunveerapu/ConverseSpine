/**
 * The bot's closers are QUESTIONS. These are the answers they receive in the
 * wild — the ones that used to fall through to a byte-identical repeat of the
 * card that asked, which is what "when the user says yes or no it doesn't
 * understand at all" actually looked like in the transcript.
 */
import { describe, expect, it } from 'vitest';
import { resolvePendingFork } from '../src/engine/pending-fork.js';
import { composedOfferIn } from '../src/engine/compose.js';
import type { PendingPrompt } from '../src/engine/turn-intent/types.js';

const forkPrompt = (options: PendingPrompt['options']): PendingPrompt => ({
  kind: 'offer_pricing',
  topic: options?.[0],
  options,
  asked_at_turn: 3,
});

describe('resolvePendingFork — answers to the question the bot asked', () => {
  const emiOrConfigs = forkPrompt(['emi', 'availability']);

  it('"both" takes the first fork and remembers the rest', () => {
    expect(resolvePendingFork('both', emiOrConfigs)).toEqual({
      kind: 'all',
      topic: 'emi',
      rest: ['availability'],
    });
  });

  it('"neither" declines the fork, not the project', () => {
    expect(resolvePendingFork('neither', emiOrConfigs)).toEqual({ kind: 'none' });
  });

  it('an ordinal picks by the order the forks were spoken', () => {
    expect(resolvePendingFork('the second one', emiOrConfigs)).toEqual({
      kind: 'pick',
      topic: 'availability',
    });
    expect(resolvePendingFork('first', emiOrConfigs)).toEqual({ kind: 'pick', topic: 'emi' });
  });

  it('naming a fork picks it', () => {
    expect(resolvePendingFork('configs', emiOrConfigs)).toEqual({
      kind: 'pick',
      topic: 'availability',
    });
  });

  it('naming a topic that was NOT offered resolves to nothing', () => {
    // Otherwise a stray word hijacks a question the fork never asked.
    expect(resolvePendingFork('amenities', emiOrConfigs)).toBeUndefined();
  });

  it('naming two topics is a request, not a pick — the router keeps it', () => {
    // Regression: this stole "pricing and legal" and silently dropped legal.
    expect(resolvePendingFork('pricing and legal', forkPrompt(['price', 'legal']))).toBeUndefined();
  });

  it('resolves nothing when no question is open', () => {
    expect(resolvePendingFork('both', undefined)).toBeUndefined();
    expect(resolvePendingFork('both', forkPrompt([]))).toBeUndefined();
  });

  it('ignores a long line — that is a message, not an answer to a fork', () => {
    const rambling = 'both of us liked it but we are still deciding between a few other places nearby';
    expect(resolvePendingFork(rambling, emiOrConfigs)).toBeUndefined();
  });
});

describe('composedOfferIn — the words and the record come from one table', () => {
  it('recognises a contextual closer the table itself emitted', () => {
    const reply =
      '*Pricing — Ayana:* ₹24.95 L. Would it help if I estimated the total cost for a specific BHK?';
    const offer = composedOfferIn(reply);
    expect(offer?.topic).toBe('availability');
    expect(offer?.options).toContain('price');
  });

  it('does not arm on the rotated filler pool', () => {
    // Binding a yes to filler produced a confused reply instead of a next step.
    const reply = 'Amenities include a clubhouse. I can also compare this with nearby options if that helps.';
    expect(composedOfferIn(reply)).toBeUndefined();
  });

  it('does not arm on prose that merely ends in a question mark', () => {
    expect(composedOfferIn('So what would you like to do next?')).toBeUndefined();
  });
});
