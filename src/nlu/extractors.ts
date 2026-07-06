import type { MemoryView, SlotWrite } from '../types.js';

const BUDGET_RE = /(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*( lakh| lakhs| l| cr| crore| crores)/i;
const BHK_RE = /(\d)\s*bhk/i;
const BHK_LOC_BUDGET_RE =
  /(\d)\s*bhk\s+([A-Za-z][A-Za-z\s]{2,20}?)\s+(\d+(?:\.\d+)?)\s*( lakh| lakhs| l| cr| crore| crores)/i;
const HINGLISH_LOC_BUDGET_RE =
  /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\s+(\d+(?:\.\d+)?)\s*( lakh| lakhs| l| cr| crore| crores)\s+budget\s+hai\b/i;
const HINGLISH_LOC_BHK_BUDGET_RE =
  /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\s+(\d)\s*bhk\s+chahiye\s+budget\s+(\d+(?:\.\d+)?)\s*( lakh| lakhs| l| cr| crore| crores)/i;
const ABOUT_PROJECT_RE =
  /\b(?:about|tell me about|details on|info on|interested in)\s+([A-Za-z][A-Za-z0-9\s'-]{2,28}?)(?:\?|\.|!|$|\s+(?:please|project))/i;
const LOKATIONS_PROJECT_RE =
  /\b(ayana|krishnaja\s+greens?)\b/i;
const BRIGADE_PROJECT_RE =
  /\b(brigade\s+(?:eldorado|orchards|calista|oasis|sanctuary|buena vista|meadows|atmosphere|cornerstone utopia)|cornerstone utopia|utopia)\b/i;
const GREETING_RE = /^(hi|hello|hey|namaste|good\s+(morning|afternoon|evening))\b/i;
const LIST_RE = /\b(show|options|projects|list|suggest|recommend|what do you have|dikhao|options dikhao)\b/i;
const PRICE_RE = /\b(price|pricing|cost|rate|how much|details on pricing|pricing batao)\b/i;
const VISIT_RE = /\b(visit|site visit|see the property|book a site|book site visit)\b/i;
const CONFIRM_RE = /^(yes|yeah|yep|ok|okay|confirm|sure|done|haan|ha)\b/i;
const LEGAL_RE = /\b(rera|legal|approval|na status|ec status|khata|rera registered)\b/i;
const OBJECTION_RE = /\b(too expensive|too far|not sure|don't like|overpriced|budget tight|seems too far|bit too expensive)\b/i;
const COMPARE_RE = /\b(compare|vs|versus|which is better|difference between|side by side)\b/i;
const BROCHURE_RE = /\b(brochure|brochure pdf|send me the brochure|share brochure)\b/i;
const FLOOR_PLAN_RE = /\b(floor plan|floorplan|layout plan|unit plan)\b/i;
const UNITS_RE =
  /\b(configurations?|unit types?|bhk options|plot sizes|what sizes|what 2 bhk|what 3 bhk|available units)\b/i;
const COMPARE_PAIR_RE =
  /\bcompare\s+(.+?)\s+(?:and|vs|versus|with)\s+(.+?)(?:\?|\.|!|$)/i;
const COMPARE_TRIPLE_RE =
  /\bcompare\s+(.+?),\s*(.+?)\s+(?:and|&)\s+(.+?)(?:\?|\.|!|$)/i;

/** Deterministic slot + intent extraction — always runs, classifier merges on top. */
export function extractDeterministic(buyerText: string, memory: MemoryView): {
  intents: string[];
  slot_writes: SlotWrite[];
  compare_names?: string[];
  media_kind?: string;
} {
  const text = buyerText.trim();
  const lower = text.toLowerCase();
  const slot_writes: SlotWrite[] = [];
  const intents: string[] = [];
  let compare_names: string[] | undefined;
  let media_kind: string | undefined;

  const bhkLocBudget = BHK_LOC_BUDGET_RE.exec(text);
  const hinglishBhk = HINGLISH_LOC_BHK_BUDGET_RE.exec(text);
  const hinglishBudget = HINGLISH_LOC_BUDGET_RE.exec(text);
  if (hinglishBhk) {
    slot_writes.push({ slot: 'location', value: hinglishBhk[1].trim() });
    slot_writes.push({ slot: 'bhk', value: `${hinglishBhk[2]} BHK` });
    slot_writes.push({
      slot: 'budget',
      value: `${hinglishBhk[3]}${hinglishBhk[4]}`.replace(/\s+/g, ' ').trim(),
    });
  } else if (hinglishBudget) {
    slot_writes.push({ slot: 'location', value: hinglishBudget[1].trim() });
    slot_writes.push({
      slot: 'budget',
      value: `${hinglishBudget[2]}${hinglishBudget[3]}`.replace(/\s+/g, ' ').trim(),
    });
  } else if (bhkLocBudget) {
    slot_writes.push({ slot: 'bhk', value: `${bhkLocBudget[1]} BHK` });
    slot_writes.push({ slot: 'location', value: bhkLocBudget[2].trim() });
    slot_writes.push({
      slot: 'budget',
      value: `${bhkLocBudget[3]}${bhkLocBudget[4]}`.replace(/\s+/g, ' ').trim(),
    });
  } else {
    const budgetMatch = BUDGET_RE.exec(text);
    if (budgetMatch) {
      const val = budgetMatch[2]
        ? `${budgetMatch[1]}-${budgetMatch[2]}${budgetMatch[3]}`
        : `${budgetMatch[1]}${budgetMatch[3]}`;
      slot_writes.push({ slot: 'budget', value: val.replace(/\s+/g, ' ').trim() });
    }
    const locBudget = /^([A-Za-z][A-Za-z\s]{2,20}?)\s+(\d+(?:\.\d+)?)\s*( lakh| lakhs| l| cr| crore| crores)\b/i.exec(
      text,
    );
    if (locBudget && !slot_writes.some((s) => s.slot === 'location')) {
      slot_writes.push({ slot: 'location', value: locBudget[1].trim() });
    }
    const bhkMatch = BHK_RE.exec(text);
    if (bhkMatch) slot_writes.push({ slot: 'bhk', value: `${bhkMatch[1]} BHK` });
  }

  if (!slot_writes.some((s) => s.slot === 'location')) {
    const meinLoc = /\b([A-Za-z][A-Za-z\s]{2,20}?)\s+mein\b/i.exec(text);
    if (meinLoc?.[1] && !/\b(lakhs|crore|bhk|budget)\b/i.test(meinLoc[1])) {
      slot_writes.push({ slot: 'location', value: meinLoc[1].trim() });
    } else {
      const inLoc = /\b(?:in|near|around)\s+([A-Za-z][A-Za-z\s]{2,24}?)(?:\s|$|[,.!?])/i.exec(text);
      if (inLoc?.[1] && !/\b(lakhs|crore|bhk)\b/i.test(inLoc[1])) {
        slot_writes.push({ slot: 'location', value: inLoc[1].trim() });
      }
    }
  }

  if (/\bplantation\s+ke\s+liye\b/i.test(lower)) {
    slot_writes.push({ slot: 'purpose', value: 'investment' });
  }

  const triple = COMPARE_TRIPLE_RE.exec(text);
  const pair = COMPARE_PAIR_RE.exec(text);
  if (triple) {
    compare_names = [triple[1], triple[2], triple[3]].map((s) => s.trim());
    intents.push('compare_projects');
  } else if (pair) {
    compare_names = [pair[1], pair[2]].map((s) => s.trim());
    intents.push('compare_projects');
  } else if (COMPARE_RE.test(lower)) {
    intents.push('compare_projects');
  }

  const hinglishAbout = /\b([A-Za-z][A-Za-z\s'-]+?)\s+ke baare mein\b/i.exec(text);
  if (hinglishAbout?.[1]) {
    const name = extractProjectName(hinglishAbout[1]) ?? hinglishAbout[1].trim();
    if (!/^(batao|dikhao|pricing)$/i.test(name)) {
      slot_writes.push({ slot: 'project_id', value: name.toLowerCase() });
      intents.push('get_project_info');
    }
  } else {
    const projectName = extractProjectName(text);
    if (projectName && !slot_writes.some((s) => s.slot === 'project_id')) {
      slot_writes.push({ slot: 'project_id', value: projectName.toLowerCase() });
      intents.push('get_project_info');
    }
  }

  if (GREETING_RE.test(text) && text.length < 40) intents.push('greeting');
  if (LIST_RE.test(lower)) intents.push('find_projects');
  if (PRICE_RE.test(lower) || /\bpricing batao\b/i.test(lower) || /^pricing\?$/i.test(text)) {
    intents.push('get_price');
  }
  if (VISIT_RE.test(lower)) {
    intents.push('book_visit');
    const visitProject = /\b(?:visit|site visit)\s+(?:for\s+)?([A-Za-z][A-Za-z0-9\s'-]{2,28}?)(?:\s+(?:on|this|next)|$)/i.exec(
      text,
    );
    if (
      visitProject?.[1] &&
      !/^(on|this|next|tomorrow|saturday|sunday|for)$/i.test(visitProject[1]) &&
      !slot_writes.some((s) => s.slot === 'project_id')
    ) {
      const name = extractProjectName(`about ${visitProject[1]}`) ?? visitProject[1].trim();
      slot_writes.push({ slot: 'project_id', value: name.toLowerCase() });
    }
  }
  if (LEGAL_RE.test(lower)) intents.push('get_legal_info');
  if (OBJECTION_RE.test(lower)) intents.push('express_objection');
  if (BROCHURE_RE.test(lower)) {
    intents.push('get_media');
    media_kind = 'brochure';
  }
  if (FLOOR_PLAN_RE.test(lower)) {
    intents.push('get_media');
    media_kind = 'floor_plan';
  }
  if (UNITS_RE.test(lower)) intents.push('get_unit_configs');
  if (CONFIRM_RE.test(lower) && memory.pending?.kind === 'visit_proposal') {
    intents.push('confirm_action');
  }
  if (intents.length === 0) intents.push('other');

  return { intents, slot_writes, compare_names, media_kind };
}

function extractProjectName(text: string): string | null {
  const visitFor = /\b(?:visit|site visit)\s+(?:for\s+)?([A-Za-z][A-Za-z0-9\s'-]{2,28}?)(?:\s+(?:on|this|next|tomorrow|saturday|sunday)|$)/i.exec(
    text,
  );
  if (visitFor?.[1] && !/^(on|this|next|tomorrow|saturday|sunday)$/i.test(visitFor[1])) {
    return visitFor[1].trim();
  }
  const about = ABOUT_PROJECT_RE.exec(text);
  if (about?.[1]) return about[1].trim();
  const lok = LOKATIONS_PROJECT_RE.exec(text);
  if (lok?.[1]) return lok[1].trim();
  const brig = BRIGADE_PROJECT_RE.exec(text);
  if (brig?.[1]) return brig[1].trim().replace(/^brigade\s+/i, 'Brigade ');
  return null;
}

export function normalizeProjectQuery(name: string): string {
  return name
    .replace(/^brigade\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
