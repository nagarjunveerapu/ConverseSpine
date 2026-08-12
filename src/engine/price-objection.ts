/**
 * Intent-before-slots: evaluative cost stance vs price information-ask.
 *
 * Generic rule (language-agnostic structure):
 *   stance/intensifier + cost lexicon  →  objection (or prefer_cheaper)
 *   interrogative / component price ask →  leave as price FAQ
 *
 * Lexicons may include multilingual tokens; callers must not special-case
 * individual smoke phrases — add tokens to the lexicon classes below.
 */
import type { Extracted, ObjectionTopic } from './types.js';

/** Buyer wants a number / sheet — not a complaint. */
const PRICE_INFO_ASK_RE =
  /\b(?:what(?:'s|\s+is)|how\s+much|tell\s+me|share|give|need|want)\b[\s\S]{0,48}\b(?:price|pricing|cost|rate|bsp|charges?)\b|\b(?:price|pricing|cost)\s*(?:batao|please|breakdown|break[- ]?up|\?)|\b(?:per\s*sq\.?\s*ft|per\s*sqft|landed\s+cost|all[- ]in\s+cost|best\s+price|any\s+discount|negotiable)\b/i;

/**
 * Stance / intensity — compositional left side of evaluative judgment.
 * Add tokens by class, not by full utterance.
 */
const STANCE_RE =
  /\b(?:too|bit|a\s+bit|quite|pretty|kinda|kind\s+of|rather|somewhat|slightly|thoda|thodi|bahut|zyada|kafi|feels?|seems?|looks?|sounds?)\b/i;

/** Cost-evaluation lexicon (EN + common Indian-English / Hinglish stems). */
const COST_EVAL_RE =
  /\b(?:expensive|pricey|costly|overpriced|steep|meheng\w*|mehng\w*)\b/i;

/** Budget-boundary objection without needing a separate intensifier. */
const BUDGET_BOUNDARY_RE =
  /\b(?:out\s+of\s+(?:my\s+)?(?:budget|range)|over\s+budget|above\s+(?:my\s+)?budget|budget\s+(?:tight|nahi|nahin)|can'?t\s+afford|cannot\s+afford|not\s+in\s+(?:my\s+)?budget)\b/i;

/** Soft ask for lower options (see_others), still not a price FAQ. */
const PREFER_CHEAPER_RE =
  /\b(?:cheaper|less\s+expensive|lower\s+(?:budget|price|options?|band)|kam\s+(?:budget|price|ke|wala)|something\s+(?:cheaper|less\s+expensive)|under\s+budget|within\s+budget\s+options?)\b/i;

/** Cost word + personal judgment without classic intensifier ("expensive for me"). */
const COST_PERSONAL_RE =
  /\b(?:expensive|pricey|costly|overpriced|meheng\w*|mehng\w*)\b[\s\S]{0,20}\b(?:for\s+me|yaar|hai|lag(?:\s+rah)|lagta)\b|\b(?:lag(?:\s+rah)|lagta\s+hai)\b[\s\S]{0,24}\b(?:expensive|pricey|costly|meheng\w*|mehng\w*)\b/i;

/** Higher-side framing. */
const HIGHER_SIDE_RE =
  /\b(?:on\s+the\s+(?:higher|expensive)\s+side|price(?:y|d)?\s+side)\b/i;

/** Exported for speech-act chip parity (same detector, one authority). */
export function hasPriceObjectionCue(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (PRICE_INFO_ASK_RE.test(t)) return false;
  if (BUDGET_BOUNDARY_RE.test(t) || HIGHER_SIDE_RE.test(t)) return true;
  if (COST_PERSONAL_RE.test(t)) return true;
  // Compositional: stance × cost-eval (works across phrasings).
  if (STANCE_RE.test(t) && COST_EVAL_RE.test(t)) return true;
  return false;
}

export function hasPreferCheaperCue(text: string): boolean {
  const t = text.trim();
  if (PRICE_INFO_ASK_RE.test(t)) return false;
  return PREFER_CHEAPER_RE.test(t);
}

/** Chip/speech-act: true when either evaluative objection or prefer-cheaper. */
export function hasCostStanceAct(text: string): boolean {
  return hasPriceObjectionCue(text) || hasPreferCheaperCue(text);
}

/** Strip topic fills that would turn an evaluative cue into a price FAQ. */
export function applyPriceObjectionAuthority(ex: Extracted, text: string): Extracted {
  const preferCheaper = hasPreferCheaperCue(text);
  const priceObj = hasPriceObjectionCue(text);
  if (!priceObj && !preferCheaper) return ex;

  const topics = (ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : [])).filter((t) => t !== 'price');
  const topic: ObjectionTopic = 'price';
  return {
    ...ex,
    objection: true,
    objectionTopic: topic,
    speechAct: ex.speechAct === 'unknown' || !ex.speechAct ? 'object' : ex.speechAct,
    ...(preferCheaper ? { transition: 'see_others' as const } : {}),
    ...(topics.length
      ? { askTopic: topics[0], askTopics: topics }
      : { askTopic: undefined, askTopics: undefined }),
  };
}

/** @deprecated use hasPriceObjectionCue — kept for call-site grep clarity */
export const PRICE_OBJECTION_NEGATIVE_RE = PRICE_INFO_ASK_RE;
