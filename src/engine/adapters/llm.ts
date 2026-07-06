import type { Env } from '../../env.js';
import type { EngineLlm, ExtractSignal, SignalKind } from '../ports.js';
import type { ComposeRequest } from '../types.js';
import { fallbackReply, renderComposePrompt } from '../compose.js';

export function makeEngineLlm(env: Env): EngineLlm {
  const base = env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  const model = env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  const apiKey = env.DEEPSEEK_API_KEY;

  async function chat(system: string, user: string, jsonMode = false): Promise<string> {
    if (!apiKey) return '';
    const resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: jsonMode ? 0.1 : 0.35,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: jsonMode ? 120 : 320,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!resp.ok) return '';
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  return {
    async compose(req: ComposeRequest): Promise<string> {
      if (!apiKey) return fallbackReply(req);
      const user = renderComposePrompt(req);
      try {
        const draft = await chat(
          'You are a warm WhatsApp property advisor. Follow instructions exactly. Never invent prices or facts.',
          user,
        );
        return draft || fallbackReply(req);
      } catch {
        return fallbackReply(req);
      }
    },

    async extractSignals(text: string, need: readonly SignalKind[]): Promise<readonly ExtractSignal[]> {
      if (!apiKey || need.length === 0) return [];
      const sys = 'Extract fields from a real-estate buyer message. Return STRICT JSON only.';
      const user =
        `Message: ${JSON.stringify(text)}\n` +
        `Return {"location": <area/city or null>, "property_type": <plantation|villa|apartment|plot or null>, ` +
        `"purpose": "self_use"|"investment"|null, "transition": "want_details"|"see_others"|"want_visit"|null}. ` +
        `Only include a field if clearly present in THIS message; otherwise null. Do not guess.`;
      try {
        const raw = await chat(sys, user, true);
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return [];
        const o = JSON.parse(m[0]) as Record<string, unknown>;
        const out: ExtractSignal[] = [];
        if (need.includes('location') && typeof o.location === 'string' && o.location.trim()) {
          out.push({ kind: 'location', value: o.location.trim() });
        }
        if (need.includes('property_type') && typeof o.property_type === 'string' && o.property_type.trim()) {
          out.push({ kind: 'property_type', value: o.property_type.trim().toLowerCase() });
        }
        if (
          need.includes('purpose') &&
          (o.purpose === 'self_use' || o.purpose === 'investment')
        ) {
          out.push({ kind: 'purpose', value: o.purpose });
        }
        const tr = o.transition;
        if (
          need.includes('transition') &&
          (tr === 'want_details' || tr === 'see_others' || tr === 'want_visit')
        ) {
          out.push({ kind: 'transition', value: tr });
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

/** Deterministic signal extraction for tests — no network. */
export function noopEngineLlm(): EngineLlm {
  return {
    async compose(req) {
      return fallbackReply(req);
    },
    async extractSignals(text, need) {
      const lc = text.toLowerCase();
      const out: ExtractSignal[] = [];
      const places = ['coorg', 'sakleshpur', 'virajpet', 'devanahalli', 'whitefield', 'madikeri'];
      if (need.includes('location')) {
        for (const pl of places) {
          if (lc.includes(pl)) {
            out.push({ kind: 'location', value: pl.charAt(0).toUpperCase() + pl.slice(1) });
            break;
          }
        }
      }
      if (need.includes('property_type') && /\bplantation\b/.test(lc)) {
        out.push({ kind: 'property_type', value: 'plantation' });
      }
      return out;
    },
  };
}
