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
  }
  addMoney(ev.floor?.display);
  if (ev.pricing) {
    addMoney(ev.pricing.startingDisplay);
    for (const c of ev.pricing.components) addMoney(c.value);
  }
  addMoney(ev.compare?.tableText);
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
  const parts = reply.split(/(?<=[.!?])\s+/);
  const kept = parts.filter((p) => !BANNED.some((re) => re.test(p)));
  const out = kept.join(' ').trim();
  return out.length > 0 ? out : reply.trim();
}
