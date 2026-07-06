import type { Env } from '../env.js';
import type { MemoryView } from '../types.js';

const CLASSIFIER_PROMPT = `You classify buyer messages for an Indian real-estate WhatsApp bot.
Return JSON only: { "intents": string[], "project_name": string|null }
Allowed intents: greeting, find_projects, get_price, get_project_info, book_visit, confirm_action, express_objection, get_legal_info, acknowledge, other.
Pick all that apply. project_name if buyer names a project.`;

/** DeepSeek structured classifier — optional when DEEPSEEK_API_KEY is set. */
export class IntentClassifier {
  constructor(private readonly env: Env) {}

  async classify(buyerText: string, memory: MemoryView): Promise<{ intents: string[]; project_name?: string }> {
    if (!this.env.DEEPSEEK_API_KEY) return { intents: [] };

    const base = this.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
    const model = this.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

    const user = [
      `Buyer: ${buyerText}`,
      `Pending: ${memory.pending?.kind ?? 'none'}`,
      `Focused project: ${memory.facts.project_id ?? 'none'}`,
    ].join('\n');

    const resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CLASSIFIER_PROMPT },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 120,
        temperature: 0,
      }),
    });

    if (!resp.ok) return { intents: [] };
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return { intents: [] };

    try {
      const parsed = JSON.parse(raw) as { intents?: string[]; project_name?: string | null };
      return {
        intents: Array.isArray(parsed.intents) ? parsed.intents.filter(Boolean) : [],
        ...(parsed.project_name ? { project_name: parsed.project_name } : {}),
      };
    } catch {
      return { intents: [] };
    }
  }
}
