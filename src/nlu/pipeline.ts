import type { Env } from '../env.js';
import type { MemoryView, UnderstandResult } from '../types.js';
import { IntentClassifier } from './classifier.js';
import { extractDeterministic } from './extractors.js';
import { IntentEmbedder } from './embedder.js';

/** NLU pipeline: deterministic extractors + embedder + classifier merge. */
export class NluPipeline {
  private classifier: IntentClassifier;
  private embedder: IntentEmbedder;

  constructor(env: Env) {
    this.classifier = new IntentClassifier(env);
    this.embedder = new IntentEmbedder(env);
  }

  async understand(buyerText: string, memory: MemoryView): Promise<UnderstandResult> {
    const det = extractDeterministic(buyerText, memory);
    const [classified, embedded] = await Promise.all([
      this.classifier.classify(buyerText, memory),
      this.embedder.matchIntent(buyerText, memory.conversation.builder_id),
    ]);

    const intentSet = new Set(det.intents);
    for (const k of classified.intents) intentSet.add(k);
    if (embedded?.kind) intentSet.add(embedded.kind);

    const slot_writes = [...det.slot_writes];
    if (classified.project_name && !slot_writes.some((s) => s.slot === 'project_id')) {
      slot_writes.push({ slot: 'project_id', value: classified.project_name.toLowerCase() });
      intentSet.add('get_project_info');
    }

    const intents = [...intentSet].map((kind) => ({ kind }));
    if (intents.length === 0) intents.push({ kind: 'other' });

    return {
      intents,
      slot_writes,
      compare_names: det.compare_names,
      media_kind: det.media_kind,
    };
  }
}
