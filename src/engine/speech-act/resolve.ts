/**
 * Free text → chip path(s) → speech act.
 * Chip tap (action_id) wins; free text resolves into the same closed menu.
 */
import { catalogEntry, catalogEntryByActionId } from './catalog.js';
import type {
  ChipPathId,
  ChipResolution,
  ResolvedChipPath,
  SpeechActKind,
} from './types.js';

/** Whole-utterance / high-precedence free-text → chip path. */
const FREE_TEXT_RULES: ReadonlyArray<{
  id: ChipPathId;
  re: RegExp;
  /** Higher = preferred as primary when multiple match. */
  priority: number;
}> = [
  // stop / handoff / greet (whole-ish)
  {
    id: 'chip.stop',
    re: /\b(?:stop|unsubscribe|opt[\s-]?out|delete my data|forget me|don't (?:message|text|contact)|do not (?:message|text|contact))\b/i,
    priority: 100,
  },
  {
    id: 'chip.handoff',
    re: /\b(?:talk to (?:a |an )?(?:human|agent|person)|speak to (?:someone|a human)|call me(?: back)?|request(?: a)? callback|escalate|connect me (?:to|with))\b/i,
    priority: 95,
  },
  {
    id: 'chip.greet',
    re: /^(?:hi|hello|hey|namaste|good (?:morning|afternoon|evening))(?:\s+[!.]*)?$/i,
    priority: 90,
  },
  // visit_recall BEFORE visit_book — booking deixis only (NOT bare "the visit")
  {
    id: 'chip.visit_recall',
    re: /\b(?:my|all) (?:site )?(?:visits?|bookings?)\b|visits? (?:i have )?(?:planned|booked|scheduled)|(?:what|which|tell me about) (?:my )?(?:visits?|bookings?)\b|(?:what|which) (?:visits?|bookings?) (?:do i|did i|have i)\b/i,
    priority: 85,
  },
  {
    id: 'chip.visit_book',
    re: /\b(?:come for (?:the |a )?visit|visit (?:them|it|the project|this)|schedule(?: a)? (?:site )?visit|plan a visit(?: day)?|book(?: a)? (?:site )?visit|(?:ok(?:ay)?|sure)[,.]?\s+(?:lets?|let'?s)\s+(?:do\s+)?(?:a\s+)?(?:site\s+)?visit|(?:lets?|let'?s)\s+(?:do\s+)?(?:a\s+)?(?:site\s+)?visit|want(?:\s+to)?\s+(?:do\s+)?(?:a\s+)?(?:site\s+)?visit|site visit|what about visit(?:ing)?)\b/i,
    priority: 80,
  },
  {
    id: 'chip.compare',
    re: /\b(?:compare|vs\.?|versus|side[\s-]by[\s-]side|difference between)\b|\bcompare (?:the |both |all )?(?:projects?|options?|them|these|both)\b|\b(?:can you |could you |please )?compare\b/i,
    priority: 75,
  },
  {
    id: 'chip.object',
    re: /\b(?:any\s+discount|best\s+price|negotiable|too\s+(?:expensive|far|risky|high|costly)|(?:feels|seems|looks|is|bit)\s+(?:too\s+)?(?:expensive|pricey|high|overpriced)|on\s+the\s+(?:higher|expensive)\s+side|out\s+of\s+(?:budget|range)|over\s+budget|not\s+convinced)\b/i,
    priority: 70,
  },
  {
    id: 'chip.answer.legal',
    re: /\b(?:rera|legal(?:\s+issues?)?|khata|title|approval|documents?|paperwork|paper\s*work|legal status|legal details|clear title|title clear|\bec\b|encumbrance(?: certificate)?|(?:which|what)\s+banks?|banks?\s+(?:approved|approv)|approved\s+banks?|home\s+loan\s+approv|is\s+(?:the\s+)?ec\s+clear)\b/i,
    priority: 65,
  },
  {
    id: 'chip.answer.price',
    re: /\b(?:prices?|pricing|cost|how much|pricing batao|landed cost|all[- ]in cost|price break[- ]?up|breakdown|component[- ]wise|per\s*(?:sq\.?\s*ft|sqft|sft)|starting\s+prices?)\b/i,
    priority: 60,
  },
  {
    id: 'chip.answer.emi',
    re: /\b(?:emi|monthly payment|installment)\b/i,
    priority: 58,
  },
  {
    // Closed chip aliases only — novel phrasings ("options for 2BHK…") stay unknown
    // and gap-fill via INTENT_VECTORS (see semantic-nlu), not unbounded regex.
    id: 'chip.answer.availability',
    re: /\b(?:plot\s+sizes?|unit\s+sizes?|unit\s+configurations?|configurations?|configs?|bhk options?|what\s+(?:sizes?|configs?|configurations?)\b|sizes?\s+offered|sq\.?\s*ft\s+(?:options?|sizes?)|units?\s+(?:available|offered)|(?:\d+(?:\.\d+)?\s*)?bhk\s+(?:configs?|configurations?|options?|sizes?)|(?:any|what)\s+(?:\d+(?:\.\d+)?\s*)?bhk\s+options?(?:\s+left)?|options?\s+left)\b/i,
    priority: 62,
  },
  {
    id: 'chip.answer.media',
    re: /\b(?:brochure|floor plan|layout|video|photos?|images?|pdf|share (?:the )?(?:brochure|plan))\b/i,
    priority: 55,
  },
  {
    id: 'chip.answer.amenities',
    re: /\b(?:amenit|facilit|clubhouse|pool|gym)\b/i,
    priority: 50,
  },
  {
    id: 'chip.answer.location',
    // Not bare "nearby" — that fires on search soft prefs ("schools nearby").
    re: /\b(?:location details?|location\s*(?:&|and)\s*connectivity|where(?:'s| is)(?: it| this)?\s*\?|connectivity|how far|micro[- ]?market|growth\s*corridor)\b|^location\s*\?$/i,
    priority: 48,
  },
  // Compare lenses (P7 chips) — keep on compare path, not project search
  {
    id: 'chip.compare',
    re: /^(?:budget fit|possession timeline|legal readiness|price per sqft|growth(?:\s*\/\s*|\s+)?corridor)$/i,
    priority: 76,
  },
  {
    id: 'chip.answer.overview',
    re: /\b(?:tell me (?:more |about )?(?:the )?project|project details?|overview|what(?:'s| is) (?:this|it) (?:about|like))\b/i,
    priority: 45,
  },
  // SA-4: bare "what about <project>?" → overview answer/switch (not visit) when no topic probe.
  // Topic-bearing "what about … pricing/legal/configs" already hit higher-priority answer chips.
  {
    id: 'chip.answer.overview',
    re: /\bwhat about\b(?!.*\b(?:visit(?:ing)?|pricing|price|legal|rera|configurations?|configs?|units?|bhk|brochure|amenities|location|emi|availability|possession|media|floor plans?)\b)/i,
    priority: 44,
  },
  {
    id: 'chip.search',
    re: /\b(?:show (?:me )?(?:more )?(?:projects?|options?)|other options?|more options?|more projects?|find (?:me )?(?:homes?|projects?|options?)|refine(?:\s+(?:the|my))?\s+search|keep refining|what (?:do you have|can you find))\b/i,
    priority: 40,
  },
];

function toResolved(
  id: ChipPathId,
  source: 'action_id' | 'free_text',
): ResolvedChipPath | null {
  const entry = catalogEntry(id);
  if (!entry) return null;
  return {
    id: entry.id,
    act: entry.act,
    ...(entry.topic ? { topic: entry.topic } : {}),
    source,
    confidence: 'rule',
  };
}

/** Match free text against closed chip menu — primary + optional secondary. */
export function resolveFreeTextToChipPaths(text: string): ChipResolution {
  const t = text.trim();
  if (!t) {
    return emptyResolution();
  }

  const hits: Array<{ id: ChipPathId; priority: number }> = [];
  for (const rule of FREE_TEXT_RULES) {
    if (rule.re.test(t)) hits.push({ id: rule.id, priority: rule.priority });
  }

  if (hits.length === 0) {
    return emptyResolution();
  }

  hits.sort((a, b) => b.priority - a.priority);
  const primaryId = hits[0]!.id;
  const primary = toResolved(primaryId, 'free_text');
  if (!primary) return emptyResolution();

  // Compound: Legal + Objection (or price + objection) — secondary only if different act family
  let secondary: ResolvedChipPath | null = null;
  const secondaryHit = hits.find((h) => {
    if (h.id === primaryId) return false;
    const entry = catalogEntry(h.id);
    if (!entry) return false;
    // Allow object as secondary when primary is answer (Legal + Objection)
    if (entry.act === 'object' && primary.act === 'answer') return true;
    // Allow answer topic as secondary when primary is object (rare)
    if (entry.act === 'answer' && primary.act === 'object') return true;
    return false;
  });
  if (secondaryHit) {
    secondary = toResolved(secondaryHit.id, 'free_text');
  } else if (
    primary.act === 'answer' &&
    (primary.topic === 'legal' || primary.topic === 'price') &&
    /\b(?:issues?|problems?|worries?|concerns?|risks?|red flags?)\b/i.test(t)
  ) {
    // "any legal issues?" → Legal primary + Objection secondary (closed compound)
    secondary = toResolved('chip.object', 'free_text');
  }

  return buildResolution(primary, secondary);
}

/** Chip tap — action_id is already the path. */
export function resolveActionIdToChipPath(actionId: string): ChipResolution {
  const entry = catalogEntryByActionId(actionId);
  if (!entry) {
    // Unknown action_id (e.g. recovery relax_bhk:drop) — treat as search refine, not unknown act
    if (/^(?:relax_|clear_|widen_|try_)/i.test(actionId) || actionId.includes(':')) {
      const search = toResolved('chip.search', 'action_id');
      return search ? buildResolution(search, null) : emptyResolution();
    }
    return emptyResolution();
  }
  const primary = toResolved(entry.id, 'action_id');
  return primary ? buildResolution(primary, null) : emptyResolution();
}

/**
 * Classify speech act from chip resolution.
 * Prefer action_id when present; else free-text resolve.
 */
export function classifySpeechAct(input: {
  text: string;
  actionId?: string;
}): ChipResolution {
  const aid = input.actionId?.trim();
  if (aid) {
    return resolveActionIdToChipPath(aid);
  }
  return resolveFreeTextToChipPaths(input.text);
}

function buildResolution(
  primary: ResolvedChipPath,
  secondary: ResolvedChipPath | null,
): ChipResolution {
  const chipPathIds: ChipPathId[] = [primary.id];
  if (secondary) chipPathIds.push(secondary.id);
  return {
    primary,
    secondary,
    speechAct: primary.act,
    chipPathIds,
  };
}

function emptyResolution(): ChipResolution {
  return {
    primary: null,
    secondary: null,
    speechAct: 'unknown',
    chipPathIds: [],
  };
}

/** Convenience for tests / debug. */
export function speechActFromResolution(r: ChipResolution): SpeechActKind {
  return r.speechAct;
}
