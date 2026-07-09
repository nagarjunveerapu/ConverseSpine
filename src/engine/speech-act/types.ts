/**
 * SA-0 — chip-canonical speech acts.
 * Closed menu shared by Advisor chips and WhatsApp free text.
 * See docs/lld/SPEECH_ACT_CONTRACT_LLD.md
 */
import type { AnswerTopic } from '../types.js';

export type SpeechActKind =
  | 'greet'
  | 'search'
  | 'answer'
  | 'switch'
  | 'compare'
  | 'visit_book'
  | 'visit_recall'
  | 'object'
  | 'handoff'
  | 'stop'
  | 'unknown';

/** Stable chip path IDs — Advisor action_id / recovery chips should use these when possible. */
export type ChipPathId =
  | 'chip.greet'
  | 'chip.search'
  | 'chip.compare'
  | 'chip.answer.price'
  | 'chip.answer.legal'
  | 'chip.answer.emi'
  | 'chip.answer.amenities'
  | 'chip.answer.availability'
  | 'chip.answer.location'
  | 'chip.answer.media'
  | 'chip.answer.overview'
  | 'chip.visit_book'
  | 'chip.visit_recall'
  | 'chip.object'
  | 'chip.handoff'
  | 'chip.stop';

export interface ChipCatalogEntry {
  id: ChipPathId;
  /** Advisor / recovery chip label (illustrative). */
  label: string;
  act: SpeechActKind;
  topic?: AnswerTopic;
  /** Exact action_id aliases (chip tap). */
  actionIds?: readonly string[];
}

export interface ResolvedChipPath {
  id: ChipPathId;
  act: SpeechActKind;
  topic?: AnswerTopic;
  source: 'action_id' | 'free_text';
  confidence: 'rule';
}

export interface ChipResolution {
  /** Primary path drives goal. */
  primary: ResolvedChipPath | null;
  /** At most one secondary (e.g. Legal + Objection). */
  secondary: ResolvedChipPath | null;
  speechAct: SpeechActKind;
  /** Provenance for debug / ledger. */
  chipPathIds: ChipPathId[];
}
