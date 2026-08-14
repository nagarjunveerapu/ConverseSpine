import { describe, expect, it } from 'vitest';
import {
  applyWaInteractiveExtract,
  waCanonicalUtterance,
  WA_PROJECT_STAMP,
} from '../src/channel/wa-pack.js';
import type { Extracted } from '../src/engine/types.js';

/**
 * A tap has to DO the thing its row promised.
 *
 * All four defects here were found on the founder's own phone, on the deployed
 * build, in one walk: the certificate row answered with a project blurb and no
 * file; "Book a visit" for a second project read the first visit back; the same
 * button, pressed while a day ask was open, replied "I could not pin that to a
 * date" — for a button containing no date. The pattern is one mistake made
 * three times: the id was turned into a sentence and the sentence was re-read
 * as if the buyer had typed it. The id is the request; only the words are a
 * fallback.
 */

const CATALOG = [
  { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
  { projectId: 'brigade-cornerstone', name: 'Brigade Cornerstone' },
];
const emptyExtract = (): Extracted => ({ constraints: {} }) as unknown as Extracted;

describe('a document row sends the document', () => {
  it('names the asset kind on the extract, not only in the sentence', () => {
    for (const kind of [
      'ownership_certificate',
      'legal_agreement',
      'allotment_letter',
      'brochure',
      'floor_plan',
      'master_plan',
      'price_sheet',
    ]) {
      const out = applyWaInteractiveExtract(
        `wa.doc.${kind}${WA_PROJECT_STAMP}brigade-eldorado`,
        emptyExtract(),
        CATALOG,
      );
      expect(out.mediaAssetKind, kind).toBe(kind);
      expect(out.askTopic, kind).toBe('media');
      // …and it still lands on the project the row was cut for.
      expect(out.namedProjects?.[0]?.projectId, kind).toBe('brigade-eldorado');
    }
  });

  it('the sentence alone was never enough — that is why the certificate never arrived', () => {
    // "share the ownership certificate" matches no media phrase in the closed
    // kind set, so the media path saw no request at all and the engine fell
    // back to a project overview. The typed kind is what makes the send happen.
    expect(waCanonicalUtterance('wa.doc.ownership_certificate')).toContain('ownership certificate');
    const out = applyWaInteractiveExtract('wa.doc.ownership_certificate', emptyExtract(), CATALOG);
    expect(out.mediaAssetKind).toBe('ownership_certificate');
  });

  it('an unknown kind stays unclaimed rather than sending the wrong file', () => {
    const out = applyWaInteractiveExtract('wa.doc.not_a_real_kind', emptyExtract(), CATALOG);
    expect(out.mediaAssetKind).toBeUndefined();
  });
});

describe('a Book a visit tap means book', () => {
  it('clears recall — one visit on the books must not answer for the next', () => {
    const withRecall = { ...emptyExtract(), recall: true } as Extracted;
    const out = applyWaInteractiveExtract('visit_book', withRecall, CATALOG);
    expect(out.speechAct).toBe('visit_book');
    expect(out.transition).toBe('want_visit');
    expect(out.recall).toBe(false);
  });
});
