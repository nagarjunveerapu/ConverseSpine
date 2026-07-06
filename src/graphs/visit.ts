import type { MemoryView } from '../types.js';

/** LangGraph-style visit subgraph — plain TS state machine (Worker-safe). */
export type VisitGraphState =
  | { step: 'propose'; project_id: string; human_label: string }
  | { step: 'confirm'; project_id: string; human_label: string }
  | { step: 'ask_day'; project_id: string };

export function runVisitGraph(
  buyerText: string,
  memory: MemoryView,
): { state: VisitGraphState; composer: 'template:visit_confirm' | 'template:visit_ask_day' } {
  const pid = memory.facts.project_id ?? memory.shortlist[0] ?? '';
  const dayMatch = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i.exec(buyerText);
  const label = dayMatch?.[1] ?? 'Saturday';

  if (memory.pending?.kind === 'visit_proposal') {
    return {
      state: {
        step: 'confirm',
        project_id: String(memory.pending.payload.project_id ?? pid),
        human_label: String(memory.pending.payload.human_label ?? label),
      },
      composer: 'template:visit_confirm',
    };
  }

  if (!dayMatch && !/\bvisit\b/i.test(buyerText)) {
    return { state: { step: 'ask_day', project_id: pid }, composer: 'template:visit_ask_day' };
  }

  return {
    state: { step: 'propose', project_id: pid, human_label: label },
    composer: 'template:visit_confirm',
  };
}
