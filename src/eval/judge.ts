import type { Env } from '../env.js';
import type { BuyerProfile } from './personas.js';
import type { TranscriptTurn } from './buyer-sim.js';

export interface QualityVerdict {
  overall_score: number;
  dimensions: {
    completeness: number;
    grounding: number;
    tone: number;
    journey_progress: number;
  };
  strengths: string[];
  issues: string[];
  summary: string;
}

const JUDGE_PROMPT = `You are a senior QA reviewer for an Indian real-estate WhatsApp sales bot.
Score the conversation 1-10 on each dimension and overall.
Return JSON only:
{
  "overall_score": number,
  "dimensions": {
    "completeness": number,
    "grounding": number,
    "tone": number,
    "journey_progress": number
  },
  "strengths": string[],
  "issues": string[],
  "summary": string
}
Scoring guide:
- completeness: Did bot address buyer questions fully?
- grounding: Prices/facts plausible and specific (not vague hand-waves)?
- tone: Professional, warm, no filler ("happy to help")?
- journey_progress: Did conversation move toward discovery → detail → visit?
Penalize: empty pricing, wrong location, visit without project, banned filler phrases.`;

/** LLM judge reads full transcript — no golden asserts. */
export async function judgeConversationQuality(
  env: Env,
  profile: BuyerProfile,
  transcript: TranscriptTurn[],
): Promise<QualityVerdict> {
  const heuristic = heuristicVerdict(transcript);
  if (!env.DEEPSEEK_API_KEY) return heuristic;

  const lines = transcript.map((t) => `${t.role.toUpperCase()}${t.composer ? ` [${t.composer}]` : ''}: ${t.text}`).join('\n');

  const user = `Buyer profile:\n${JSON.stringify(profile, null, 2)}\n\nTranscript:\n${lines}`;

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
        messages: [
          { role: 'system', content: JUDGE_PROMPT },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0,
      }),
    });
    if (!resp.ok) return heuristic;
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return heuristic;
    const parsed = JSON.parse(raw) as QualityVerdict;
    return { ...heuristic, ...parsed, dimensions: { ...heuristic.dimensions, ...parsed.dimensions } };
  } catch {
    return heuristic;
  }
}

/** Fast checks the judge should not miss — merged with LLM verdict. */
function heuristicVerdict(transcript: TranscriptTurn[]): QualityVerdict {
  const botLines = transcript.filter((t) => t.role === 'bot').map((t) => t.text);
  const issues: string[] = [];
  const strengths: string[] = [];

  const allBot = botLines.join('\n').toLowerCase();
  if (/happy to help|feel free to reach|is there anything else/i.test(allBot)) {
    issues.push('Banned filler phrase detected in bot reply');
  }
  if (botLines.some((l) => /couldn't phrase them safely/i.test(l))) {
    issues.push('Grounding gate blocked a reply — buyer saw fallback message');
  }
  if (botLines.some((l) => /Pricing for \*\*:/.test(l) || /Pricing for \*\*\s*\n/.test(l))) {
    issues.push('Pricing template missing project name');
  }
  if (botLines.some((l) => /\bthe project\b/i.test(l) && !/\*[A-Za-z]/.test(l))) {
    issues.push('Visit or reply used generic "the project" instead of name');
  }
  if (botLines.some((l) => /₹[\d.]+\s*L|₹[\d.]+\/sqft/i.test(l))) strengths.push('Bot cited specific price points');
  if (botLines.some((l) => /visit.*confirm|confirmed for|Shall I block/i.test(l))) strengths.push('Visit flow reached confirmation');
  if (botLines.some((l) => /comparison|Location\s+\|/i.test(l))) strengths.push('Comparison table delivered');
  if (botLines.some((l) => /https?:\/\//i.test(l))) strengths.push('Media/document link shared');
  if (botLines.some((l) => /Configurations at|unit_type|\*[\d.]+\s*BHK/i.test(l))) strengths.push('Unit configurations listed');

  const penalty = issues.length * 1.5;
  const bonus = strengths.length * 0.5;
  const overall = Math.max(1, Math.min(10, 7 - penalty + bonus));

  return {
    overall_score: overall,
    dimensions: {
      completeness: overall,
      grounding: issues.some((i) => i.includes('Grounding')) ? 4 : 7,
      tone: issues.some((i) => i.includes('filler')) ? 5 : 8,
      journey_progress: strengths.some((s) => s.includes('Visit')) ? 8 : 6,
    },
    strengths,
    issues,
    summary: issues.length ? `Heuristic flagged ${issues.length} issue(s).` : 'Heuristic pass — no obvious defects.',
  };
}
