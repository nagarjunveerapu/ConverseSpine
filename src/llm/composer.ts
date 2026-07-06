import type { Env } from '../env.js';
import type { MemoryView, ToolResult } from '../types.js';

const SYSTEM = `You are a WhatsApp property advisor for an Indian builder.
Rules: be concise (under 120 words), no "happy to help" or filler closers.
Use ONLY facts from TOOL RESULTS for prices, RERA, locations. If a fact is missing, say you'll confirm at the visit.
Tone: warm, direct, professional.`;

/** LLM compose lane — only when decide returns composer: 'llm'. */
export class LlmComposer {
  constructor(private readonly env: Env) {}

  async compose(
    buyerText: string,
    memory: MemoryView,
    toolResults: ToolResult[],
  ): Promise<string> {
    const primary = await this.callPrimary(buyerText, memory, toolResults);
    if (primary) return primary;
    return this.stub(toolResults, memory);
  }

  private async callPrimary(
    buyerText: string,
    memory: MemoryView,
    toolResults: ToolResult[],
  ): Promise<string | null> {
    if (!this.env.DEEPSEEK_API_KEY) return null;

    const base = this.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
    const model = this.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

    const toolJson = JSON.stringify(
      toolResults.filter((t) => t.success).map((t) => t.output),
    ).slice(0, 4000);

    const user = [
      `Buyer: ${buyerText}`,
      `Known slots: bhk=${memory.facts.bhk ?? '-'}, budget=${memory.facts.budget ?? '-'}, location=${memory.facts.location ?? '-'}`,
      `TOOL RESULTS: ${toolJson || 'none'}`,
    ].join('\n');

    try {
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
          max_tokens: 280,
          temperature: 0.4,
        }),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private stub(toolResults: ToolResult[], memory: MemoryView): string {
    const lookup = toolResults.find((t) => t.success && t.output.name);
    if (lookup) {
      const o = lookup.output;
      return `${o.name} is in ${o.micro_market}. Prices start around ₹${o.starting_price_lakhs} L. RERA: ${o.rera || 'on file'}. Want pricing in detail or a site visit?`;
    }
    const parts = [memory.facts.bhk, memory.facts.budget, memory.facts.location].filter(Boolean);
    if (parts.length) {
      return `I've noted ${parts.join(', ')}. Say "show me options" and I'll pull matching projects from the catalog.`;
    }
    return "Tell me location, budget, and BHK — or name a project — and I'll pull live data from the catalog.";
  }
}
