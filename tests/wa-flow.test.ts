import { describe, expect, it } from 'vitest';
import { utteranceFromNfmReply } from '../src/engine/wa-flow.js';

describe('utteranceFromNfmReply', () => {
  it('turns visit date+time JSON into the canonical utterance', () => {
    expect(utteranceFromNfmReply('{"date":"2026-09-22","time":"3:00 PM"}')).toBe(
      '2026-09-22 at 3:00 PM',
    );
    expect(utteranceFromNfmReply('{"flow_token":"visit"}')).toBeUndefined();
    expect(utteranceFromNfmReply('not-json')).toBeUndefined();
  });

  it('joins stop names so the which-projects chooser can bind them', () => {
    expect(
      utteranceFromNfmReply(
        '{"job":"stops","stops":["Brigade Eternia","Brigade Cornerstone"]}',
      ),
    ).toBe('Brigade Eternia and Brigade Cornerstone');
    expect(utteranceFromNfmReply('{"job":"stops","all":true}')).toBe('all of them');
  });

  it('passes origin through as typed text', () => {
    expect(utteranceFromNfmReply('{"job":"origin","origin":"Koramangala"}')).toBe('Koramangala');
  });

  it('folds the brief into one constraint line', () => {
    expect(
      utteranceFromNfmReply(
        '{"job":"brief","bhk":"3 BHK","area":"Yelahanka","budget":"Under ₹1 Cr"}',
      ),
    ).toBe('3 BHK in Yelahanka, Under ₹1 Cr');
  });

  it('does not turn a registration day into a site-visit ISO utterance', () => {
    expect(
      utteranceFromNfmReply('{"job":"regdate","date":"2026-10-08","time":"12:00 PM"}'),
    ).toBe('sub-registrar on 8 October 2026 at 12:00 PM');
  });
});
