/** Buyer-facing copy — aligned with Naya first-touch + list framing. */

export interface CatalogProjectLine {
  name: string;
  micro_market: string;
  project_type?: string;
  starting_price_display?: string;
  starting_price_lakhs?: number;
  match_reasons?: string[];
}

export interface BuilderVoice {
  bot_name: string;
  builder_name: string;
  bot_signature?: string;
  preferred_tone?: string;
}

export function stripBuilderNameEnvSuffix(name: string | undefined): string {
  if (!name) return '';
  return name
    .replace(/\s*[([](?:dev|staging|test|qa|uat|prod|sandbox|demo)[)\]]\s*$/i, '')
    .trim();
}

export function humanizePortfolioTypes(types: string[]): string {
  const labels = new Set<string>();
  for (const t of types) {
    const lc = t.toLowerCase();
    if (lc.includes('apartment') || lc.includes('flat')) labels.add('apartments');
    else if (lc.includes('plantation') || lc.includes('plot') || lc === 'plotted') {
      labels.add('managed plantation estates');
    } else if (lc.includes('villa')) labels.add('villas');
    else labels.add(t.replace(/_/g, ' '));
  }
  const arr = [...labels];
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0]!;
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
}

export function formatPortfolioOrientation(
  projects: ReadonlyArray<{ project_type?: string; micro_market: string }>,
): string {
  if (projects.length === 0) return '';
  const typeLabels = humanizePortfolioTypes(
    [...new Set(projects.map((m) => m.project_type ?? '').filter(Boolean))],
  );
  const markets = [...new Set(projects.map((m) => m.micro_market).filter(Boolean))];
  if (!typeLabels) return '';
  if (markets.length > 0) {
    const sample = markets.slice(0, 3).join(', ');
    return `We have ${typeLabels} across ${sample}${markets.length > 3 ? ' and nearby areas' : ''}.`;
  }
  return `Our portfolio includes ${typeLabels}.`;
}

export function formatWelcomeLine(voice: BuilderVoice): string {
  const name = voice.bot_name || 'your advisor';
  const builder = stripBuilderNameEnvSuffix(voice.builder_name);
  return builder
    ? `Hello! I'm ${name} from ${builder}, your property assistant.`
    : `Hello! I'm ${name}, your property assistant.`;
}

/** Turn-1 bare greeting — portfolio-aware, one orienting question. */
const BANNED_FILLER_RE =
  /\b(happy to help|happy to answer any more questions|looking forward to helping|feel free to reach out|is there anything else|i hope that helps|please don't hesitate)\b/i;

export function sanitizeBuyerFacingText(text: string): string {
  return text
    .split(/\n\n+/)
    .filter((block) => !BANNED_FILLER_RE.test(block))
    .join('\n\n')
    .trim();
}

export function formatFirstTouchGreeting(
  voice: BuilderVoice,
  portfolioOrientation: string,
): string {
  const welcome = formatWelcomeLine(voice);
  const portfolio = portfolioOrientation ? `${portfolioOrientation} ` : '';
  const body =
    `${portfolio}I can help you explore our projects, pricing, and site visits. ` +
    `What kind of property are you looking for — any preferred location or budget?`;
  const sig = voice.bot_signature?.trim();
  const withSig =
    sig && !BANNED_FILLER_RE.test(sig) ? `${welcome}\n\n${body}\n\n${sig}` : `${welcome}\n\n${body}`;
  return sanitizeBuyerFacingText(withSig);
}

/** Returning buyer — warm, no full re-intro. */
export function formatReturningGreeting(voice: BuilderVoice, buyerName?: string): string {
  const name = voice.bot_name || 'your advisor';
  if (buyerName?.trim()) {
    return `Good to hear from you again${buyerName.trim() ? `, ${buyerName.trim()}` : ''}! I'm ${name} — tell me what you'd like to check next.`;
  }
  return `Welcome back! I'm ${name} — we can pick up from where we left off. What would you like to explore?`;
}

function priceLabel(p: CatalogProjectLine): string {
  if (p.starting_price_display?.trim()) return p.starting_price_display.trim();
  if (p.starting_price_lakhs) return `₹${p.starting_price_lakhs} L`;
  return 'price on request';
}

function humanizeProjectType(type?: string): string {
  if (!type) return 'project';
  const lc = type.toLowerCase();
  if (lc.includes('plantation')) return 'managed plantation estate';
  if (lc.includes('apartment')) return 'apartment project';
  if (lc.includes('villa')) return 'villa project';
  if (lc.includes('plot')) return 'plotted development';
  return type.replace(/_/g, ' ');
}

/** Numbered list — Naya-style ready-to-quote shape. */
export function formatProjectList(args: {
  projects: CatalogProjectLine[];
  filters?: { location?: string; budget?: string; bhk?: string; purpose?: string };
  includeWelcome?: boolean;
  voice?: BuilderVoice;
  portfolioOrientation?: string;
}): string {
  const { projects, filters, includeWelcome, voice, portfolioOrientation } = args;
  const parts: string[] = [];

  if (includeWelcome && voice) {
    parts.push(formatWelcomeLine(voice));
    if (portfolioOrientation) parts.push(portfolioOrientation);
  }

  const filterBits = [filters?.location, filters?.budget, filters?.bhk, filters?.purpose].filter(Boolean);
  if (filterBits.length > 0) {
    parts.push(`Based on ${filterBits.join(', ')}, here are options from our catalog:`);
  } else if (!includeWelcome) {
    parts.push('Here are projects from our catalog:');
  } else {
    parts.push('Here are options that may fit:');
  }

  if (projects.length === 0) {
    parts.push(
      "I couldn't find an exact match with those filters. Try a nearby area, a broader budget, or name a project like Ayana or Krishnaja Greens.",
    );
    return parts.join('\n\n');
  }

  const lines = projects.map((p, i) => {
    const typeHint = p.project_type ? ` (${humanizeProjectType(p.project_type)})` : '';
    const reason =
      p.match_reasons?.[0] && !/^budget fits$/i.test(p.match_reasons[0])
        ? ` — ${p.match_reasons[0]}`
        : '';
    return `${i + 1}. *${p.name}*${typeHint} in ${p.micro_market || 'our portfolio'}, starting at ${priceLabel(p)}${reason}`;
  });
  parts.push(lines.join('\n'));
  parts.push('Which one would you like to explore first?');
  return parts.join('\n\n');
}

/** Project snapshot — first presentation shape. */
export function formatProjectDetail(args: {
  name: string;
  micro_market: string;
  project_type?: string;
  starting_price_display?: string;
  starting_price_lakhs?: number;
  summary?: string;
  possession_date?: string;
  rera?: string;
}): string {
  const typeLabel = humanizeProjectType(args.project_type);
  const loc = args.micro_market || 'our portfolio';
  const opener = `*${args.name}* is a ${typeLabel} in ${loc}${args.possession_date ? `, with possession ${args.possession_date}` : ''}.`;
  const price = args.starting_price_display?.trim()
    ? `Starting from ${args.starting_price_display.trim()} (indicative).`
    : args.starting_price_lakhs
      ? `Starting from ₹${args.starting_price_lakhs} L (indicative).`
      : '';
  const summary = args.summary?.trim()
    ? args.summary.trim().split(/(?<=[.!?])\s+/)[0]?.slice(0, 280) ?? ''
    : '';
  const lines = [opener];
  if (price) lines.push(price);
  if (summary) lines.push(summary);
  if (args.rera?.trim()) lines.push(`RERA: ${args.rera.trim()}`);
  lines.push('Would you like a price breakdown, brochure, or to book a site visit?');
  return lines.join('\n\n');
}

export function formatSlotAck(facts: Record<string, string | undefined>): string | null {
  const bits: string[] = [];
  if (facts.location) bits.push(facts.location);
  if (facts.budget) bits.push(`budget ${facts.budget}`);
  if (facts.bhk) bits.push(facts.bhk);
  if (facts.purpose) bits.push(facts.purpose);
  if (bits.length === 0) return null;
  return `Got it — ${bits.join(', ')}.`;
}

export function formatCompareTable(tableText: string | undefined, projects: Array<{ name?: string }>): string {
  if (tableText?.trim()) {
    return `Here's a side-by-side comparison:\n\n${tableText.trim()}\n\nWhich project would you like to explore further?`;
  }
  const names = projects.map((p) => p.name).filter(Boolean);
  if (names.length >= 2) {
    return `I compared ${names.join(' and ')} — ask me about pricing, configurations, or a site visit for either one.`;
  }
  return 'I need at least two projects to compare — tell me which ones.';
}

export interface CompareProjectFacts {
  name?: string;
  micro_market?: string;
  project_type?: string;
  starting_price_lakhs?: number;
  starting_price_display?: string;
  possession_date?: string;
}

/** Consultative follow-up after a side-by-side compare — grounded in catalog facts only. */
export function formatCompareAdvice(
  buyerText: string,
  projects: CompareProjectFacts[],
): string {
  const named = projects.filter((p) => p.name);
  if (named.length < 2) {
    return 'Name two projects you want me to compare, or say "compare X and Y" first — then I can help you choose.';
  }

  const lower = buyerText.toLowerCase();
  const [a, b] = named;
  const priceA = a.starting_price_lakhs ?? 0;
  const priceB = b.starting_price_lakhs ?? 0;
  const cheaper = priceA && priceB ? (priceA <= priceB ? a : b) : a;
  const premium = cheaper === a ? b : a;
  const priceLabel = (p: CompareProjectFacts) =>
    p.starting_price_display?.trim() || (p.starting_price_lakhs ? `₹${p.starting_price_lakhs} L` : 'price on request');

  if (/\binvest(ment|or)?\b|\breturns?\b|\byield\b|\brental\b|\bplantation\b/i.test(lower)) {
    const ready =
      a.possession_date?.toLowerCase().includes('ready') ? a
      : b.possession_date?.toLowerCase().includes('ready') ? b
      : null;
    const lines = [
      `For *investment*, here's how they differ on what's in our catalog:`,
      `• *${cheaper.name}* — lower entry at ${priceLabel(cheaper)}${cheaper.possession_date ? `, possession ${cheaper.possession_date}` : ''}`,
      `• *${premium.name}* — ${priceLabel(premium)}${premium.possession_date ? `, possession ${premium.possession_date}` : ''}`,
    ];
    if (ready && ready !== cheaper) {
      lines.push(`*${ready.name}* is ready to register now — that can matter if you want income or registration sooner.`);
    } else if (cheaper !== premium) {
      lines.push(`*${cheaper.name}* has the lower entry point if capital efficiency is the priority.`);
    }
    lines.push('Happy to walk through projected yields on a call — or book site visits to both and decide on the ground.');
    return lines.join('\n');
  }

  if (/\bfamil(y|ies)\b|\bkids\b|\bschool\b|\bliving\b|\bself[- ]use\b/i.test(lower)) {
    const apt =
      a.project_type?.toLowerCase().includes('apartment') ? a
      : b.project_type?.toLowerCase().includes('apartment') ? b
      : null;
    const lines = [
      `For *families*, I'd weigh location and configuration fit:`,
      `• *${a.name}* — ${a.micro_market ?? 'on file'}${a.project_type ? ` (${a.project_type.replace(/_/g, ' ')})` : ''}, from ${priceLabel(a)}`,
      `• *${b.name}* — ${b.micro_market ?? 'on file'}${b.project_type ? ` (${b.project_type.replace(/_/g, ' ')})` : ''}, from ${priceLabel(b)}`,
    ];
    if (apt) {
      lines.push(`*${apt.name}* is the apartment option — usually easier for daily city living and amenities.`);
    }
    lines.push('Tell me your must-haves (commute, BHK, budget) and I can narrow this further, or book visits to both.');
    return lines.join('\n');
  }

  return [
    `Both are solid options — here's a quick read from our catalog:`,
    `• *${a.name}* — ${a.micro_market ?? 'on file'}, from ${priceLabel(a)}`,
    `• *${b.name}* — ${b.micro_market ?? 'on file'}, from ${priceLabel(b)}`,
    `Tell me what matters most — budget, possession timeline, location, or investment vs self-use — and I'll steer you.`,
  ].join('\n');
}

export function formatMediaShare(args: {
  project_name?: string;
  allowed: boolean;
  title?: string;
  cdn_url?: string;
  asset_kind?: string;
  redirect_hint?: string;
}): string {
  const label = args.asset_kind?.replace(/_/g, ' ') ?? 'document';
  if (args.allowed && args.cdn_url) {
    return `Here is the ${args.title ?? label} for *${args.project_name ?? 'the project'}* — ${args.cdn_url}`;
  }
  if (args.redirect_hint) {
    return `I don't have the ${label} ready to share right now — ${args.redirect_hint}. Anything else I can help with?`;
  }
  return `I don't have the ${label} available to share right now — I can walk you through the details here or arrange it at your site visit.`;
}

export function formatUnitConfigs(args: {
  project_name?: string;
  units: Array<{ unit_type: string; price_display?: string; size_sqft?: string }>;
}): string {
  if (!args.units.length) {
    return `Configuration details for *${args.project_name ?? 'this project'}* aren't published yet — I can share pricing or book a visit to see options on site.`;
  }
  const lines = args.units.map(
    (u) => `• *${u.unit_type}*${u.size_sqft ? ` — ${u.size_sqft}` : ''}${u.price_display ? `, ${u.price_display}` : ''}`,
  );
  return `Configurations at *${args.project_name ?? 'the project'}*:\n${lines.join('\n')}\n\nWant pricing in detail, a floor plan, or a site visit?`;
}
