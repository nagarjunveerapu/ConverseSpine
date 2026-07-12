import { describe, it, expect } from 'vitest';
import { renderComposePrompt, buildComposeRequest } from '../src/engine/compose.js';
import type { EvidenceSet } from '../src/engine/types.js';

/**
 * W8 — facet answers must anchor which project they describe. Dev re-baseline
 * (ADV-H01, ADV-F01): factually-correct pricing replies that never said
 * "Eldorado"/"Orchards" read as unanchored and fail multi-project chats.
 */
describe('W8 name-the-project compose rule', () => {
  const detail = { projectId: 'p1', name: 'Brigade Orchards', microMarket: 'Sarjapur' };

  it('answer goals with detail evidence instruct the model to name the project once', () => {
    const req = buildComposeRequest(
      { kind: 'answer', topic: 'price', projectId: 'p1' },
      { tools: [], detail } as EvidenceSet,
      { constraints: {} },
    );
    expect(renderComposePrompt(req)).toMatch(/Name the project \(\*Brigade Orchards\*\) once/);
  });

  it('non-answer goals are untouched', () => {
    const req = buildComposeRequest(
      { kind: 'recommend' },
      { tools: [], detail } as EvidenceSet,
      { constraints: {} },
    );
    expect(renderComposePrompt(req)).not.toMatch(/Name the project/);
  });
});
