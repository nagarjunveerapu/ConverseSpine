import type { Env } from '../../env.js';
import type { TurnIntentInput, TurnIntentResult } from './types.js';

const VALID_KINDS = new Set<TurnIntentResult['kind']>([
  'apply_recovery_patch',
  'confirm_suggestion',
  'probe',
  'ask_named_project',
  'reject_and_widen',
  'compare_among_offered',
  'continue_brief',
  'continue_search',
  'focused_question',
  'release_focus',
  'broaden_constraints',
  'unknown',
]);

function buildPrompt(input: TurnIntentInput): string {
  const pack = {
    text: input.text,
    channel: input.channel,
    phase: input.phase,
    ui_mode: input.ui_mode,
    constraints: input.constraints,
    last_goal_kind: input.last_goal_kind,
    last_evidence_kind: input.last_evidence_kind ?? null,
    last_reply_excerpt: input.last_reply_excerpt,
    pending_prompt: input.pending_prompt ?? null,
    suggested_actions: input.suggested_actions.map((a) => ({
      id: a.id,
      label: a.label,
      user_line: a.user_line,
    })),
    last_offered: input.last_offered,
    recent_turns: input.recent_turns,
  };
  return JSON.stringify(pack);
}

const SYSTEM = `You classify buyer intent for property search recovery on WhatsApp/advisor.
Return STRICT JSON only — no markdown.
Schema: {"kind": string, "confidence": "llm", "patch": object|null, "patch_clear": string[]|null, "focus_project_id": string|null, "matched_action_id": string|null, "probe_prompt": string|null}

Rules:
- Bare "yes"/"ok" with pending_prompt.kind=offer_project → confirm_suggestion + focus_project_id if known
- Bare "yes" with offer_widen, chip_menu, binary_budget_or_area, or missing pending → probe (never guess)
- Chip label or user_line match in text → apply_recovery_patch + matched_action_id
- "2 cr any apartment", budget/BHK/type changes → apply_recovery_patch + patch/patch_clear
- Named project ("show Clarks") → ask_named_project + focus_project_id if matched in last_offered
- "no"/"not that" → reject_and_widen
- phase=focused + area/budget/type pivot ("Bangalore projects", "looking in Whitefield") → release_focus or broaden_constraints + patch
- patch_clear may include: bhk, location, propertyType, budget
- Never invent project ids or prices`;

function parseResult(raw: string): TurnIntentResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== 'string' || !VALID_KINDS.has(kind as TurnIntentResult['kind'])) return null;
    const patchClear = Array.isArray(o.patch_clear)
      ? (o.patch_clear.filter((k) => typeof k === 'string') as TurnIntentResult['patch_clear'])
      : undefined;
    const patchRaw = o.patch && typeof o.patch === 'object' ? (o.patch as Record<string, unknown>) : undefined;
    const patch = patchRaw
      ? {
          ...(typeof patchRaw.bhk === 'string' ? { bhk: patchRaw.bhk } : {}),
          ...(typeof patchRaw.location === 'string' ? { location: patchRaw.location } : {}),
          ...(typeof patchRaw.propertyType === 'string' ? { propertyType: patchRaw.propertyType } : {}),
          ...(typeof patchRaw.budgetMaxInr === 'number' ? { budgetMaxInr: patchRaw.budgetMaxInr } : {}),
        }
      : undefined;
    return {
      kind: kind as TurnIntentResult['kind'],
      confidence: 'llm',
      ...(patch && Object.keys(patch).length ? { patch } : {}),
      ...(patchClear?.length ? { patch_clear: patchClear } : {}),
      ...(typeof o.focus_project_id === 'string' ? { focus_project_id: o.focus_project_id } : {}),
      ...(typeof o.matched_action_id === 'string' ? { matched_action_id: o.matched_action_id } : {}),
      ...(typeof o.probe_prompt === 'string' ? { probe_prompt: o.probe_prompt.slice(0, 240) } : {}),
    };
  } catch {
    return null;
  }
}

async function chatJson(
  base: string,
  model: string,
  apiKey: string | undefined,
  user: string,
): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const resp = await fetch(`${base.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      max_tokens: 200,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) return '';
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export async function classifyTurnIntentLlm(
  env: Env,
  input: TurnIntentInput,
): Promise<TurnIntentResult | null> {
  const user = buildPrompt(input);

  const ollamaBase = env.OLLAMA_BASE_URL?.trim();
  if (ollamaBase) {
    const model = env.OLLAMA_MODEL ?? 'llama3.1:8b-instruct';
    const raw = await chatJson(ollamaBase, model, undefined, user);
    const parsed = parseResult(raw);
    if (parsed) return parsed;
  }

  if (env.DEEPSEEK_API_KEY) {
    const base = env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
    const model = env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    let raw = await chatJson(base, model, env.DEEPSEEK_API_KEY, user);
    let parsed = parseResult(raw);
    if (parsed) return parsed;
    raw = await chatJson(base, model, env.DEEPSEEK_API_KEY, user);
    parsed = parseResult(raw);
    if (parsed) return parsed;
  }

  return null;
}
