import type { MemoryView } from '../types.js';

interface Playbook {
  objection_topic: string;
  reframe_angles: string;
  trigger_phrases: string;
}

/** Objection subgraph — playbook match from NayaDesk, template compose. */
export function runObjectionGraph(
  buyerText: string,
  memory: MemoryView,
): { topic: string; reframe: string } | null {
  const playbooks = memory.objectionPlaybooks ?? [];
  const lower = buyerText.toLowerCase();

  for (const pb of playbooks) {
    let triggers: string[] = [];
    try {
      triggers = JSON.parse(pb.trigger_phrases || '[]') as string[];
    } catch {
      triggers = [];
    }
    if (triggers.some((t) => lower.includes(t.toLowerCase()))) {
      let angles: string[] = [];
      try {
        angles = JSON.parse(pb.reframe_angles || '[]') as string[];
      } catch {
        angles = [pb.reframe_angles];
      }
      return { topic: pb.objection_topic, reframe: angles[0] ?? 'Happy to walk through the numbers on a call.' };
    }
  }

  if (/\b(too expensive|overpriced|budget tight|over budget|above my budget|out of budget)\b/i.test(lower)) {
    return {
      topic: 'price',
      reframe: 'We can look at a smaller configuration or a nearby micro-market that fits your budget better.',
    };
  }
  return null;
}
