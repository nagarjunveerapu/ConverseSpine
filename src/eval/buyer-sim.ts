import type { Env } from '../env.js';
import type { BuyerProfile } from './personas.js';
import { profileOpeningMessage } from './personas.js';
import type { BuilderCatalog } from './catalog.js';
import { catalogSummary } from './catalog.js';

export interface TranscriptTurn {
  role: 'buyer' | 'bot';
  text: string;
  composer?: string;
  turn_index?: number;
}

const STYLE_HINT: Record<BuyerProfile['style'], string> = {
  direct: 'Short messages. One intent per message.',
  chatty: 'Slightly longer, friendly tone.',
  skeptical: 'Ask follow-ups, push on price or location.',
  hinglish: 'Mix Hindi and English naturally (e.g. "budget 80 lakh hai", "visit karna hai").',
};

/** LLM plays the buyer — next message given profile + transcript. */
export async function simulateBuyerMessage(
  env: Env,
  profile: BuyerProfile,
  transcript: TranscriptTurn[],
  catalog?: BuilderCatalog,
): Promise<string> {
  if (profile.script?.length) return scriptedBuyerMessage(profile, transcript);

  if (!env.DEEPSEEK_API_KEY) return fallbackBuyerMessage(profile, transcript);

  const history = transcript
    .slice(-8)
    .map((t) => `${t.role === 'buyer' ? 'Buyer' : 'Bot'}: ${t.text}`)
    .join('\n');

  const system = `You simulate a WhatsApp buyer for a real-estate bot eval.
${catalog ? `Builder catalog (only ask about these): ${catalogSummary(catalog)}` : ''}
Profile: ${JSON.stringify({
    name: profile.name,
    goal: profile.goal,
    scenario: profile.scenario_id,
    bhk: profile.bhk,
    budget: profile.budget,
    location: profile.location,
    purpose: profile.purpose,
    project: profile.project_interest,
  })}
Style: ${STYLE_HINT[profile.style]}
Rules:
- ONE message only, as the buyer would type on WhatsApp (no quotes).
- Progress toward the goal naturally; don't repeat yourself.
- If the bot answered your question, move to the next step (pricing, details, visit).
- If conversation feels complete (visit booked or clear next step), reply exactly: [DONE]`;

  const user = history
    ? `Conversation so far:\n${history}\n\nWrite the buyer's NEXT message:`
    : `Write the buyer's opening message (say hi and share needs or ask about ${profile.project_interest ?? 'options'}):`;

  const base = env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
  const model = env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  try {
    const resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 120,
        temperature: 0.7,
      }),
    });
    if (!resp.ok) return fallbackBuyerMessage(profile, transcript);
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    return text.replace(/^["']|["']$/g, '') || fallbackBuyerMessage(profile, transcript);
  } catch {
    return fallbackBuyerMessage(profile, transcript);
  }
}

function scriptedBuyerMessage(profile: BuyerProfile, transcript: TranscriptTurn[]): string {
  const n = transcript.filter((t) => t.role === 'buyer').length;
  const script = profile.script ?? [];
  return script[Math.min(n, script.length - 1)]!;
}

/** Deterministic fallback when no API key — scripted journey shape. */
function fallbackBuyerMessage(
  profile: BuyerProfile,
  transcript: TranscriptTurn[],
): string {
  if (profile.script?.length) return scriptedBuyerMessage(profile, transcript);
  const n = transcript.filter((t) => t.role === 'buyer').length;
  const script = [
    'hi',
    profileOpeningMessage(profile),
    profile.project_interest ? `tell me about ${profile.project_interest}` : 'show me options',
    'price details please',
    'i would like a site visit saturday',
    'yes',
    '[DONE]',
  ];
  return script[Math.min(n, script.length - 1)]!;
}

export function isDoneMessage(text: string): boolean {
  return /^\[DONE\]\s*$/i.test(text.trim()) || text.trim().toLowerCase() === 'done';
}
