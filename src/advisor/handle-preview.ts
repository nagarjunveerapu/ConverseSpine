/**
 * NayaAdvisor "narrowing preview" ingress.
 *
 * Powers the SPA thinking-strip: given the brief so far (chip taps / free-text
 * extract already merged into `preferences`), return an honest match count and
 * the top cards — with NO side effects. Unlike /api/advisor/turn this never
 * loads or saves state, never appends a message, never asks the priority
 * question, never prefetches detail. It is a pure read, so the SPA can fire it
 * on every debounced change and cache by the constraint set.
 */
import type { ConverseRuntime } from '../runtime/deps.js';
import { constraintsFromAdvisorPreferences } from './apply-preferences.js';
import { runPreview, type PreviewCard } from '../engine/preview.js';
import type { Constraints } from '../engine/types.js';

const DEFAULT_ADVISOR_BUILDER = 'naya-advisor';

export interface AdvisorPreviewRequest {
  builder_id?: string;
  preferences?: Record<string, string | undefined>;
}

export interface AdvisorPreviewResponse {
  status: 'ok' | 'error';
  count: number;
  capped: boolean;
  narrowing: boolean;
  matches: PreviewCard[];
  error?: string;
}

export async function handleAdvisorPreview(
  rt: ConverseRuntime,
  body: AdvisorPreviewRequest,
): Promise<AdvisorPreviewResponse> {
  const builder_id =
    body.builder_id?.trim() ||
    rt.env.ADVISOR_BUILDER_ID?.trim() ||
    rt.env.DEFAULT_BUILDER_ID?.trim() ||
    DEFAULT_ADVISOR_BUILDER;

  const prefs = body.preferences ?? {};
  const constraints = constraintsFromAdvisorPreferences(prefs) as Constraints;

  try {
    const result = await runPreview(rt.engine, builder_id, constraints);
    return { status: 'ok', ...result };
  } catch (err) {
    // A preview never blocks the buyer — on any failure report "no narrowing
    // yet" so the strip falls back to the typing indicator, never an error.
    void err;
    return { status: 'ok', count: 0, capped: false, narrowing: false, matches: [] };
  }
}
