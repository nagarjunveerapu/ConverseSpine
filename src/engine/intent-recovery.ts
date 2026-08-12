/**
 * Intent recovery — last-mile LLM when regex + embed + BAML slot-fill abstain.
 *
 * Closed labels only. Cost is intentional (months of paid recovery → teach queue).
 * See docs/lld/INTENT_RECOVERY_LLD.md
 */
import type { Env } from '../env.js';
import { hasPriceObjectionCue } from './price-objection.js';
import type { Extracted, ObjectionTopic } from './types.js';

export type IntentRecoveryMode = 'off' | 'shadow' | 'promote';

export type IntentRecoveryLabel =
  | 'objection_price'
  | 'prefer_cheaper'
  | 'visit_answer'
  | 'household_context'
  | 'continue_focus'
  | 'soft_rank';

export type IntentRecoveryResult = {
  confidence: 'llm' | 'abstain';
  labels: IntentRecoveryLabel[];
  abstainReason?: string;
};

export type IntentRecoveryReport = {
  mode: IntentRecoveryMode;
  called: boolean;
  confidence?: 'llm' | 'abstain';
  labels: IntentRecoveryLabel[];
  abstain_reason?: string;
  /** Always true when called — eligible for teach/train review. */
  train_eligible: boolean;
};

const VALID = new Set<IntentRecoveryLabel>([
  'objection_price',
  'prefer_cheaper',
  'visit_answer',
  'household_context',
  'continue_focus',
  'soft_rank',
]);

const SYSTEM = `You recover buyer INTENT from a WhatsApp real-estate message when closed extractors abstained.
Return STRICT JSON only.
Schema: {"labels": string[], "confidence": "llm"|"abstain", "abstain_reason": string|null}

Allowed labels ONLY:
- objection_price: too expensive / mehengaa / out of budget
- prefer_cheaper: ask for cheaper / lower options same area
- visit_answer: answering a visit day/time/origin question (saturday, coming from X)
- household_context: family size / kids / who will live there (not a search brief alone)
- continue_focus: stay on current project with a soft preference (less crowded, etc.)
- soft_rank: ranking preference without new hard constraints

Rules:
- If unsure, confidence=abstain and labels=[].
- Never invent project names, prices, or localities.
- Multiple labels OK when clearly present.`;

export function resolveIntentRecoveryMode(
  env: Pick<Env, 'INTENT_RECOVERY_MODE' | 'DEEPSEEK_API_KEY' | 'BAML_EXTRACT_MODE'>,
): IntentRecoveryMode {
  const raw = (env.INTENT_RECOVERY_MODE ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'promote') return raw;
  // Default: follow BAML promote when key present (dev), else shadow.
  if (!env.DEEPSEEK_API_KEY) return 'off';
  const baml = (env.BAML_EXTRACT_MODE ?? '').trim().toLowerCase();
  return baml === 'promote' ? 'promote' : 'shadow';
}

/** Call recovery when extract is still empty of actionable intent. */
export function needsIntentRecovery(ex: Extracted, text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (ex.stop || ex.wantsHuman) return false;
  if (ex.speechAct === 'greet' || ex.speechAct === 'stop' || ex.speechAct === 'handoff') return false;
  if (ex.objection) return false;
  // Wrong-class: BAML/embed filled price but text is evaluative — still recover.
  const topics = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  if (topics.length === 1 && topics[0] === 'price' && hasPriceObjectionCue(t)) {
    return true;
  }
  if (ex.askTopics?.length || ex.askTopic) return false;
  if (ex.transition && ex.transition !== 'none') return false;
  if (ex.namedProjects?.length || ex.pickName) return false;
  // Already a full search brief — decide can recommend/probe without recovery.
  const c = ex.constraints;
  if (c.location && c.budgetMaxInr !== undefined && (c.bhk || c.purpose === 'investment')) {
    return false;
  }
  return true;
}

export function parseIntentRecoveryResult(raw: string): IntentRecoveryResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const confidence = o.confidence === 'llm' || o.confidence === 'abstain' ? o.confidence : 'abstain';
    const labels = Array.isArray(o.labels)
      ? o.labels.filter((x): x is IntentRecoveryLabel => typeof x === 'string' && VALID.has(x as IntentRecoveryLabel))
      : [];
    if (confidence === 'abstain' || !labels.length) {
      return {
        confidence: 'abstain',
        labels: [],
        ...(typeof o.abstain_reason === 'string'
          ? { abstainReason: o.abstain_reason.slice(0, 160) }
          : {}),
      };
    }
    return { confidence: 'llm', labels };
  } catch {
    return null;
  }
}

export function applyIntentRecovery(ex: Extracted, result: IntentRecoveryResult): Extracted {
  if (result.confidence !== 'llm' || !result.labels.length) return ex;
  let next = { ...ex };
  const labels = result.labels;

  if (labels.includes('objection_price') || labels.includes('prefer_cheaper')) {
    const topic: ObjectionTopic = 'price';
    const restTopics = (next.askTopics ?? (next.askTopic ? [next.askTopic] : [])).filter(
      (t) => t !== 'price',
    );
    next = {
      ...next,
      objection: true,
      objectionTopic: topic,
      speechAct: next.speechAct === 'unknown' || !next.speechAct ? 'object' : next.speechAct,
      ...(labels.includes('prefer_cheaper') ? { transition: 'see_others' as const } : {}),
      ...(restTopics.length
        ? { askTopic: restTopics[0], askTopics: restTopics }
        : { askTopic: undefined, askTopics: undefined }),
    };
  }
  if (labels.includes('visit_answer')) {
    next = { ...next, transition: 'want_visit', speechAct: 'visit_book' };
  }
  if (labels.includes('household_context') && !next.constraints.purpose) {
    next = {
      ...next,
      constraints: { ...next.constraints, purpose: 'self_use' },
    };
  }
  if (labels.includes('continue_focus') && !next.askTopic) {
    // Soft stay-on-project — overview keeps focused.decide from clarifying.
    next = { ...next, askTopic: 'overview', askTopics: ['overview'] };
  }
  if (labels.includes('soft_rank') && !next.constraints.priorityFocus) {
    next = {
      ...next,
      constraints: { ...next.constraints, priorityFocus: 'balanced' },
    };
  }
  return next;
}

export async function runIntentRecovery(input: {
  text: string;
  phase: string;
  focusName?: string;
  chat: (system: string, user: string, json?: boolean) => Promise<string>;
}): Promise<IntentRecoveryResult | null> {
  const user =
    `phase=${input.phase}` +
    (input.focusName ? ` focus=${JSON.stringify(input.focusName)}` : '') +
    `\nmessage=${JSON.stringify(input.text)}`;
  try {
    const raw = await input.chat(SYSTEM, user, true);
    return parseIntentRecoveryResult(raw);
  } catch {
    return null;
  }
}

/** DeepSeek JSON path — same pattern as extractTurnFactsBaml. */
export async function recoverIntentWithEnv(
  env: Pick<Env, 'DEEPSEEK_API_KEY' | 'DEEPSEEK_BASE_URL' | 'DEEPSEEK_MODEL'>,
  input: { text: string; phase: string; focusName?: string },
): Promise<IntentRecoveryResult | null> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const base = (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
  const model = env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  return runIntentRecovery({
    ...input,
    chat: async (system, user, jsonMode) => {
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 160,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (!resp.ok) return '';
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    },
  });
}
