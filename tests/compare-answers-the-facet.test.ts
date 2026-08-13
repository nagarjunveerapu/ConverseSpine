import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import { deliveredFactKeys } from '../src/engine/answer-contract.js';
import type { ComposeRequest } from '../src/engine/types.js';

/**
 * L06 on the live line — six comparison questions, one answer:
 *    7 > which of the two is bigger
 *    8 > which one is closer to the airport
 *    9 > which is ready first
 *   10 > compare the 2 bhk in both
 *   11 > maintenance in both
 *   12 > which one has the better clubhouse
 * Every one of them got the identical eight-row card, three of them byte for
 * byte. The card was never wrong — it just never answered. And the matrix has
 * been carrying keyed rows the whole time; nothing read them.
 */
const MATRIX = {
  projects: [
    { project_id: 'p1', name: 'Brigade Eldorado' },
    { project_id: 'p2', name: 'Brigade Orchards' },
  ],
  rows: [
    {
      key: 'location',
      label: 'Location',
      values: ['Aerospace Park / Devanahalli Corridor', 'Devanahalli / Airport Corridor'],
    },
    {
      key: 'possession',
      label: 'Possession',
      values: ['Phase-wise; Dioro & Beryl: June 2028', 'Phase-wise; current phase June 2027'],
    },
    { key: 'starting_price', label: 'Starting price', values: ['₹31 L', '₹41 L'] },
  ],
};

const TABLE = '*Side-by-side comparison*\nLocation…\nPossession…\nStarting price…';

function req(buyerText: string): ComposeRequest {
  return {
    goal: { kind: 'answer', topic: 'compare' },
    evidence: { tools: ['compare'], compare: { tableText: TABLE, projects: [{}, {}], matrix: MATRIX } },
    context: { buyerText, channel: 'whatsapp' },
  } as unknown as ComposeRequest;
}

describe('a comparison answers the facet it was asked about', () => {
  it('leads with possession when the question is which is ready first', () => {
    const reply = fallbackReply(req('which is ready first'));

    expect(reply).toMatch(/^\*Possession\*/);
    expect(reply).toContain('June 2028');
    expect(reply).toContain('June 2027');
    // Both projects named, so the answer stands on its own.
    expect(reply).toContain('Brigade Eldorado');
    expect(reply).toContain('Brigade Orchards');
    // Not the whole card.
    expect(reply).not.toContain('Side-by-side comparison');
  });

  it('leads with location when the question is about the airport', () => {
    const reply = fallbackReply(req('which one is closer to the airport'));

    expect(reply).toMatch(/^\*Location\*/);
    expect(reply).toContain('Airport Corridor');
    expect(reply).not.toContain('Side-by-side comparison');
  });

  it('offers the rows it did not lead with, so nothing is buried', () => {
    const reply = fallbackReply(req('which is ready first'));

    expect(reply).toMatch(/side by side too/i);
    expect(reply.toLowerCase()).toContain('location');
    expect(reply.toLowerCase()).toContain('starting price');
  });

  it('still sends the full card when the question names no facet', () => {
    const reply = fallbackReply(req('compare these two'));

    expect(reply).toContain('Side-by-side comparison');
  });

  it('counts a matrix row as the fact delivered', () => {
    // Teaching the closed set that "which is ready first" is a possession ask
    // made the answer contract require possession — which `deliveredFactKeys`
    // only ever looked for on a single project's detail. Both dates were sitting
    // in the matrix and the buyer got "I don't have possession on file."
    const ev = req('which is ready first').evidence;
    expect(deliveredFactKeys(ev)).toContain('possession');

    // An em-dash column is the table saying it has nothing — not a delivery.
    const empty = {
      ...ev,
      compare: {
        ...ev.compare!,
        matrix: { ...MATRIX, rows: [{ key: 'possession', label: 'Possession', values: ['—', '—'] }] },
      },
    };
    expect(deliveredFactKeys(empty)).not.toContain('possession');
  });

  it('does not fake a lead for a facet the table has no row for', () => {
    // "maintenance in both" and "the better clubhouse" are real questions the
    // comparison cannot answer. Leading with an unrelated row would claim it did.
    for (const text of ['maintenance in both', 'which one has the better clubhouse']) {
      const reply = fallbackReply(req(text));
      expect(reply).not.toMatch(/^\*Possession\*/);
      expect(reply).not.toMatch(/^\*Location\*/);
    }
  });
});
