import type { EvidenceSet } from './types.js';
import { formatInr } from './compose.js';

const BANNED: readonly RegExp[] = [
  /happy to help/i,
  /is there anything else/i,
  /feel free to reach out/i,
  /don'?t hesitate/i,
  /hope (?:that|this) helps/i,
];

const MONEY_RE = /₹\s?\d[\d,]*(?:\.\d+)?\s*(?:l\b|lakhs?|lacs?|cr\b|crores?)?|\b\d+(?:\.\d+)?\s*(?:lakhs?|lacs?|l\b|cr\b|crores?)\b/gi;

function normMoney(s: string): string {
  return s
    .toLowerCase()
    .replace(/[₹,\s]/g, '')
    .replace(/lakhs?|lacs?/g, 'l')
    .replace(/crores?/g, 'cr');
}

function allowedTokens(ev: EvidenceSet, buyerText: string): Set<string> {
  const money = new Set<string>();
  const addMoney = (s?: string) => {
    if (!s) return;
    for (const m of s.matchAll(MONEY_RE)) money.add(normMoney(m[0]));
  };

  for (const m of ev.matches ?? []) {
    addMoney(m.startingPriceDisplay);
    if (!m.startingPriceDisplay && m.startingPriceInr > 0) addMoney(formatInr(m.startingPriceInr));
    // Desk-authored trade-off notes carry evidence-grade ₹ figures
    // ("₹15 L over your budget") — allowed, else repair eats the note.
    addMoney(m.tradeoffNote);
    // Typed receipts carry the same class of figures ("your 10,000 sqft
    // ≈ ₹50 L") — same whitelist, or verify eats the four-questions line.
    for (const f of m.dimensionFit ?? []) addMoney(f.evidence);
  }
  addMoney(ev.floor?.display);
  if (ev.pricing) {
    addMoney(ev.pricing.startingDisplay);
    for (const c of ev.pricing.components) addMoney(c.value);
  }
  addMoney(ev.compare?.tableText);
  // Shortlist-wide facet values (EMI, starting prices) are evidence-grade figures.
  for (const f of ev.shortlistFacet?.facets ?? []) {
    for (const p of f.perProject) addMoney(p.value);
  }
  if (ev.detail) addMoney(ev.detail.startingPriceDisplay);
  if (ev.catalog?.priceMinInr) addMoney(formatInr(ev.catalog.priceMinInr));
  addMoney(buyerText);

  return new Set([...money].map((x) => `$${x}`));
}

export interface GroundingCheck {
  grounded: boolean;
  unbacked: string[];
}

export function checkGrounding(reply: string, ev: EvidenceSet, buyerText: string): GroundingCheck {
  const allowed = allowedTokens(ev, buyerText);
  const unbacked: string[] = [];
  for (const m of reply.matchAll(MONEY_RE)) {
    if (!allowed.has(`$${normMoney(m[0])}`)) unbacked.push(m[0]);
  }
  return { grounded: unbacked.length === 0, unbacked };
}

export function stripBanned(reply: string): string {
  // Clean replies pass through untouched — the split/rejoin below replaces
  // every post-sentence separator with a single space, which was eating the
  // newlines between template bullet lines whose values end in a period
  // (shortlist legal blocks rendered glued: "…on request. • *Next Project*").
  if (!BANNED.some((re) => re.test(reply))) return reply.trim();
  const parts = reply.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => !BANNED.some((re) => re.test(p)));
  const out = kept.join(' ').trim();
  return out.length > 0 ? out : reply.trim();
}

/**
 * A trailing internal directive tacked onto a reply — "… — offer to follow up",
 * "… — do not quote this number". Desk `redirect_hint` values (disclosure.ts) and
 * the turn GOAL are written in imperative instruction voice for the composer to
 * ACT on, not to print. The deterministic composer no longer echoes them; this is
 * the last gate for an LLM draft that parroted one. Scoped to the exact internal
 * vocabulary so it can never eat a real buyer sentence.
 */
const DIRECTIVE_TAIL =
  /\s*[—–-]+\s*(?:offer(?:s|ing)?\s+(?:to\s+|a\s+)?(?:follow[\s-]*up|site\s+visit)|do\s+not\s+(?:quote|invent|disclose)[^.!?]*|pivot\s+to\s+(?:current\s+)?inventory|add\s+(?:the\s+)?buyer\s+to[^.!?]*|reassure\s+(?:a\s+)?human[^.!?]*|not\s+for\s+buyer\s+disclosure|not\s+currently\s+sharable)\.?\s*$/i;

/** Whole sentence that is pure composer meta — a leaked prompt instruction, not a reply. */
const DIRECTIVE_SENTENCE =
  /\bEVIDENCE\b|\buse\s+the\s+exact\s+(?:copy|template|proposed)\b|\b(?:do\s+not|don'?t)\s+invent\b|\breframe\s+using\b|\bredirect[_\s]?hint\b/i;

/**
 * A sentence that BEGINS with a bare directive verb ("offer to follow up",
 * "pivot to current inventory") — a whole draft that is nothing but the leaked
 * instruction, with no em-dash to trip DIRECTIVE_TAIL. Anchored to the start so a
 * real reply ("I can offer to follow up with pricing") is never dropped.
 */
const DIRECTIVE_LEAD =
  /^\s*(?:offer(?:s|ing)?\s+(?:to\s+|a\s+)?(?:follow[\s-]*up|site\s+visit)|pivot\s+to\s+(?:current\s+)?inventory|reassure\s+(?:a\s+)?human|do\s+not\s+(?:quote|invent|disclose)|add\s+(?:the\s+)?buyer\s+to|not\s+for\s+buyer\s+disclosure|not\s+currently\s+sharable)\b/i;

/**
 * Strip leaked internal composer directives before send. Removes a trailing
 * directive clause first, then drops any whole sentence that is pure meta.
 *
 * Returns '' when the WHOLE draft was directive — a pure-directive draft has no
 * buyer content to keep, and re-emitting the input would ship the very leak this
 * guards. The caller treats '' as "compose the template floor instead" (never
 * blank, never the directive). Review AB-10 note 1.
 */
export function stripComposerDirectives(reply: string): string {
  const out = reply.replace(DIRECTIVE_TAIL, '').trim();
  const parts = out.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => !DIRECTIVE_SENTENCE.test(p) && !DIRECTIVE_LEAD.test(p));
  return kept.join(' ').trim();
}
