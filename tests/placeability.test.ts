import { describe, expect, it } from 'vitest';
import { isNonPlaceUtterance, isPlausiblePlaceLabel } from '../src/engine/placeability.js';

describe('placeability', () => {
  it('rejects keyboard smash and chat filler', () => {
    expect(isNonPlaceUtterance('asdfghjkl qwerty')).toBe(true);
    expect(isNonPlaceUtterance('lmao ok fine')).toBe(true);
    expect(isPlausiblePlaceLabel('lmao')).toBe(false);
    expect(isPlausiblePlaceLabel('asdfghjkl qwerty')).toBe(false);
  });

  it('rejects smalltalk-as-origin', () => {
    expect(isNonPlaceUtterance('why is cricket so popular in india lol')).toBe(true);
  });

  it('accepts real places', () => {
    expect(isPlausiblePlaceLabel('Indiranagar')).toBe(true);
    expect(isPlausiblePlaceLabel('Whitefield')).toBe(true);
    expect(isNonPlaceUtterance('Indiranagar')).toBe(false);
  });

  it('rejects Advisor SPA chrome as place labels', () => {
    expect(isPlausiblePlaceLabel('board')).toBe(false);
    expect(isPlausiblePlaceLabel('the board')).toBe(false);
    expect(isPlausiblePlaceLabel('shortlist')).toBe(false);
  });

  it('treats a buyer nudging an idle chat as chat, never a place', () => {
    // O38 on the live book: "hello?" then "anyone there?" both drew
    // "I couldn't make sense of that" — the same sentence, twice.
    expect(isNonPlaceUtterance('hello?')).toBe(true);
    expect(isNonPlaceUtterance('anyone there?')).toBe(true);
    expect(isNonPlaceUtterance('u there')).toBe(true);
    expect(isNonPlaceUtterance('hi')).toBe(true);
    expect(isPlausiblePlaceLabel('hello')).toBe(false);
    // …without swallowing a real ask that happens to open with a greeting.
    expect(isNonPlaceUtterance('hi, what is the price of Brigade Eldorado?')).toBe(false);
  });

  it('does not treat catalog / next-step questions as noise', () => {
    expect(isNonPlaceUtterance('what should I do next?')).toBe(false);
    expect(isNonPlaceUtterance('which of these have proper khata and approvals?')).toBe(false);
    expect(isNonPlaceUtterance('what will be the approximate cost of these?')).toBe(false);
  });
});
