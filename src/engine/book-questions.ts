/**
 * Questions about the LINE and the BOOK — not about a property.
 *
 * "are you a bot?", "is this the official Brigade number?", "do I pay you
 * commission?", "what do you do with my number?", "how many projects do you
 * have?", "which is the cheapest?", "anything in Whitefield?"
 *
 * All of these used to reach the below-threshold guard and come back with one
 * defensive sentence asking for a size or budget. On a builder-allotted
 * WhatsApp line these are the FIRST things a real buyer types, and refusing to
 * answer "who is this?" costs more trust than any routing miss: the buyer is
 * deciding whether to keep talking at all.
 *
 * ── On the no-new-regex rule ────────────────────────────────────────────────
 * The standing rule is that recognition misses get fixed in the embedding lane
 * (corpus / labels / τ / fact_keys), never with new regex in the ladder. That
 * rule protects the PROPERTY-intent classifier from competing patterns, and it
 * still holds — nothing here touches askTopic or the intent ladder.
 *
 * These are questions about the channel and the catalog. They have exactly one
 * correct answer each, that answer never varies by buyer, and there is no
 * property intent to misclassify. Kept in one file, resolved at one seam, so it
 * can be deleted wholesale the day the corpus covers it.
 */

export type BookQuestion =
  /** Am I talking to a person, a bot, the builder, or a stranger? */
  | 'line_identity'
  /** Do I pay you? Are you a broker? */
  | 'fees'
  /** What happens to my phone number? */
  | 'privacy'
  /** Put me through to a human. */
  | 'human'
  /** How big is the book? */
  | 'count'
  /** Cheapest / entry-level. */
  | 'cheapest'
  /** Most premium / top of the book. */
  | 'premium'
  /** "Which one would you recommend?" — the buyer hands the choice back. */
  | 'recommend_pick'
  /** "Do you have Prestige Lakeside?" — named a project that is not this
   *  builder's, so it will never be on the book. */
  | 'not_on_book'
  /** "Anything in Jayanagar?" — named a locality this builder does not build
   *  in. Different sentence from `not_on_book`: not a rival, just not here. */
  | 'not_in_area'
  /** "Where is your office?", "what is your email id?" — wants a channel this
   *  line cannot hand over. */
  | 'contact_channel'
  /** "Who will show me around the site?" — a visit question wearing a person's
   *  clothes. */
  | 'site_host';

const PATTERNS: ReadonlyArray<readonly [BookQuestion, RegExp]> = [
  ['human', /\b(?:talk|speak|connect)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:human|person|someone|agent|executive)\b|\bget someone to call\b|\bcall me back\b|\bhuman please\b/i],
  ['fees', /\b(?:are you|is this) a broker\b|\bbrokerage\b|\bcommission\b|\bdo i (?:have to )?pay (?:you|any)\b|\bany (?:charges|fees) (?:to|for) me\b/i],
  ['privacy', /\bwhat (?:do|will) you do with my (?:number|phone|data|details)\b|\bspam me\b|\bshare my (?:number|details)\b|\bwill i get calls\b/i],
  ['line_identity', /\b(?:are you|r u) (?:a )?(?:bot|robot|human|real|person|machine)\b|\bwho (?:is|are) (?:this|you)\b|\bis (?:this|it) (?:the )?official\b|\bwho built (?:this|you)\b|\breal person or\b/i],
  ['count', /\bhow many (?:projects|properties|options)\b|\bwhat (?:projects|properties|do you) (?:do you )?have\b|\bfull (?:list|book|portfolio)\b|\ball your projects\b/i],
  ['cheapest', /\b(?:cheapest|lowest priced?|least expensive|most affordable|entry level|budget option|starting price)\b/i],
  ['premium', /\b(?:most )?(?:premium|luxury|luxurious|highest priced?|top end|most expensive|flagship)\b/i],
  ['recommend_pick', /\bwhich one (?:would you|do you|should i)\b|\bwhat (?:would|do) you recommend\b|\byour recommendation\b|\bwhich is (?:the )?best\b|\bwhat do (?:most|other) (?:people|buyers) (?:pick|choose|buy)\b/i],
];

/**
 * "Do you have <something>?" where the something never resolved.
 *
 * Called only at the seam where the engine has already failed to find a
 * project, a topic or a served location in the turn — so by the time this runs,
 * whatever was named is provably not on the book. Kept out of `PATTERNS` for
 * that reason: it is not a question the text alone can identify, it is one the
 * router's own failure identifies.
 */
export function asksForSomethingNotOnBook(
  text: string,
): 'not_on_book' | 'not_in_area' | undefined {
  const t = text.trim();
  if (!t || t.length > 120) return undefined;
  const asks =
    /\b(?:do you have|do u have|got any|is there|any(?:thing)?\s+(?:in|at|near)|available in)\b/i.test(
      t,
    );
  if (!asks) return undefined;
  // Something was actually named. A bare "do you have anything?" must NOT be
  // told it isn't ours — that is both wrong and rude — so one of the two shapes
  // has to be present: a location after in/at/near, or a two-word proper noun.
  //
  // The word after in/at/near is only a place if it isn't one of the generic
  // nouns that follow the same preposition ("anything in that range", "anything
  // in stock"). No place names here — the served set is the catalog's to know.
  const loc = /\b(?:in|at|near)\s+(?:the\s+)?([A-Za-z][A-Za-z-]{3,})/.exec(t);
  const GENERIC =
    /^(?:that|this|mind|range|budget|stock|hand|between|around|under|below|above|total|full|same|case|which|what|there|here|terms|other|less|more|both|city|town|area|areas|price|prices|lakh|lakhs|crore|crores|month|months|year|years)$/i;
  if (loc && !GENERIC.test(loc[1]!)) return 'not_in_area';
  if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t)) return 'not_on_book';
  return undefined;
}

/**
 * The three answers that reply with a person instead of the book. Kept beside
 * the matcher so a fourth handoff variant cannot be added without the catalog
 * guard learning about it.
 */
export const HANDOFF_QUESTIONS: ReadonlySet<BookQuestion> = new Set([
  'human',
  'contact_channel',
  'site_host',
]);

/**
 * "Get me a person" — in all the shapes buyers actually type it.
 *
 * Resolved ABOVE the focused-answer path, because a handoff ask is not a
 * question about the open project: with a focus set, "can someone call me?"
 * used to reach the fact layer and come back "I don't have that on file for
 * Brigade Eldorado", which reads as a refusal to a request we can actually
 * honour. Nothing here touches askTopic — see the module note on the regex rule.
 */
export function asksForAHuman(
  text: string,
): 'human' | 'contact_channel' | 'site_host' | undefined {
  const t = text.trim();
  if (!t || t.length > 160) return undefined;
  // "do not call, just message me here" is the OPPOSITE request and must never
  // trigger a callback promise.
  if (/\b(?:do ?n[o']?t|dont|no|never|stop)\s+(?:call|calling|phone|ring)\b|\bno calls?\b/i.test(t)) {
    return undefined;
  }
  if (/\bwho (?:will|would|is going to|shows?)\b.*\b(?:show|take|walk|meet|guide|accompany)\b|\bshow me (?:a)?round\b/i.test(t)) {
    return 'site_host';
  }
  if (/\b(?:e-?mail(?: ?id| ?address)?|mail id)\b|\bwhere (?:is|are) (?:your|the) office\b|\boffice address\b|\bcome to (?:your|the) office\b/i.test(t)) {
    return 'contact_channel';
  }
  if (
    /\b(?:sales|relationship|account|site)?\s*(?:manager|executive|representative|rep|agent|advisor|adviser|team member|salesperson)\b/i.test(t) ||
    /\b(?:can|could|will|would)\s+(?:someone|somebody|anyone|anybody|a person|your team)\b/i.test(t) ||
    /\b(?:is|are)\s+(?:anyone|anybody|someone|somebody|any(?:one)? from (?:your|the) team)\b/i.test(t) ||
    /\bput me (?:on|through) with\b|\bconnect me\b|\btransfer me\b|\bget someone\b|\bcall me\b|\bcall back\b|\bring me\b/i.test(t) ||
    // "I am busy this week, reach out next month" — a callback request that
    // never says the word "call".
    /\b(?:reach out|get in touch|touch base|contact me|follow up with me)\b/i.test(t)
  ) {
    return 'human';
  }
  return undefined;
}

/**
 * Which line-or-book question this text is, if any. Returns undefined for
 * anything that is a property question — those belong to the intent layer and
 * must not be intercepted here.
 */
export function resolveBookQuestion(text: string): BookQuestion | undefined {
  const t = text.trim();
  if (!t || t.length > 160) return undefined;
  const hits = PATTERNS.filter(([, re]) => re.test(t)).map(([q]) => q);
  // Two different readings means this is not the unambiguous case this module
  // exists for — let the normal router have it.
  if (hits.length !== 1) return undefined;
  return hits[0];
}

/**
 * The buyer told us about THEMSELVES, not about a property.
 *
 * "this is my first home, where do I start?", "I am moving from Delhi", "we
 * have two small kids", "I work from home", "looking for a weekend home".
 * There is no fact being requested, so the router found no topic and the turn
 * fell to the clarify floor — which asked the buyer to say it again. Nothing
 * reads as more evasive than that: they just told us the most personal thing
 * they were going to tell us.
 *
 * Every answer below follows one shape — repeat the situation back in their own
 * terms, then offer the ONE narrowing this line is allowed to ask for. Never a
 * purpose, city, worry, school or commute probe; never a claim about a project
 * that the book does not record.
 */
export type Situation =
  | 'first_home'
  | 'relocating'
  | 'family'
  | 'work_space'
  | 'second_home';

const SITUATIONS: ReadonlyArray<readonly [Situation, RegExp]> = [
  ['first_home', /\bfirst (?:home|house|flat|property|time buyer)\b|\bfirst[- ]time\b|\bnever bought\b|\bwhere do i (?:start|begin)\b/i],
  ['relocating', /\b(?:moving|relocat\w+|shifting|transferr?ing)\s+(?:from|to|here)\b|\bnew to (?:the )?city\b|\bdon'?t know (?:the )?areas?\b/i],
  ['family', /\b(?:small |young |two |three |2 |3 )?kids\b|\bchildren\b|\bfamily of \d\b|\bschool[- ]going\b/i],
  ['work_space', /\bwork(?:ing)? from home\b|\bwfh\b|\bstudy room\b|\bhome office\b/i],
  ['second_home', /\bweekend home\b|\bsecond home\b|\bholiday home\b|\bgetaway\b/i],
];

/** Which opening situation this is, if exactly one reading fits. */
export function resolveSituation(text: string): Situation | undefined {
  const t = text.trim();
  if (!t || t.length > 200) return undefined;
  const hits = SITUATIONS.filter(([, re]) => re.test(t)).map(([s]) => s);
  if (hits.length !== 1) return undefined;
  return hits[0];
}

/** The situation, answered — acknowledged, then the one cut we may ask for. */
export function answerSituation(s: Situation, f: BookFacts): string {
  const brand = f.builderName.trim() || 'this builder';
  const where = f.markets.length ? f.markets.slice(0, 3).join(', ') : '';
  switch (s) {
    case 'first_home':
      return `Your first one — then let me lay out how this goes, so nothing arrives as a surprise. Pick any project on the book and I'll give you its price, its configurations and its legal papers. If it holds up, we book a site visit. Paperwork and the home loan come after that, and I can walk you through both. Start wherever you like below, or tell me a size and I'll cut the book to it.`;
    case 'relocating':
      return where
        ? `Coming in from outside, the quickest way to get your bearings is by corridor rather than by address. *${brand}* builds in ${where}. Tap whichever of those you want to look at first, or tell me a size or a budget and I'll cut the book to fit.`
        : `Coming in from outside, the quickest way to get your bearings is by corridor rather than by address. Here's the whole book — open anything that looks close, or tell me a size or a budget and I'll cut it to fit.`;
    case 'family':
      return `Noted — and with children in the house the room count usually decides it before anything else does. Tell me 2 BHK or 3 BHK and I'll cut the book to it; sizes and layouts are per project, so open any one and I'll give you both.`;
    case 'work_space':
      return `A room to work in is really a room-count question, so let's start there — 2 BHK or 3 BHK, and I'll cut the book to it. Layouts and sizes are per project, and I'll give you those once you open one.`;
    case 'second_home':
      return where
        ? `A place to go to rather than live in — understood. The book runs across ${where}. Tell me which of those interests you, or a budget, and I'll cut it down from there.`
        : `A place to go to rather than live in — understood. Here's the whole book; tell me a budget and I'll cut it down from there.`;
  }
}

export interface BookFacts {
  builderName: string;
  total: number;
  minDisplay?: string;
  maxDisplay?: string;
  cheapestName?: string;
  premiumName?: string;
  markets: readonly string[];
  /** The project the buyer already has open, when there is one. */
  focusName?: string;
}

/** The answer, spoken from the book's own numbers. Never a promise we can't keep. */
export function answerBookQuestion(q: BookQuestion, f: BookFacts): string {
  const brand = f.builderName.trim() || 'this builder';
  switch (q) {
    case 'line_identity':
      return `You're on *${brand}*'s official WhatsApp line, and I'm the assistant on it — not a person, though a real one from the team can take over any time you want. I can pull pricing, configurations, legal papers and site visits straight from ${brand}'s own records.`;
    case 'fees':
      return `No brokerage, no commission — this is *${brand}*'s own line, so you're dealing with the builder directly. Nothing you do here costs you anything.`;
    case 'privacy':
      return `Your number is used to follow up on this enquiry and nothing else — no lists, no selling it on. If you'd rather not be called, say so and I'll keep it to WhatsApp.`;
    case 'human': {
      // A handoff ask is never a question about a project, so it must never be
      // answered with "I don't have that on file" — but if a project is open,
      // saying which one it is about is the difference between a promise and a
      // form submission.
      const about = f.focusName ? ` about *${f.focusName}*` : '';
      // "call me tomorrow after 6pm", "call me on 98450…", "reach out next
      // month" all arrive here. Rather than parse a time or a number badly, say
      // the true thing: the message itself goes to the team verbatim.
      return `Of course — I'll have someone from the *${brand}* team reach out${about}. Your message goes to them exactly as you wrote it, so if you've named a time or a number they'll have it. I can keep helping here meanwhile.`;
    }
    case 'contact_channel':
      // We genuinely do not hold the office address or a mailbox on this line.
      // Inventing either is the one thing worse than not having it.
      return `I don't have an office address or an email to hand you from here — this line is WhatsApp only. What I can do is have someone from the *${brand}* team reach out with both, or set up a site visit so you meet them at the project itself.`;
    case 'site_host': {
      const at = f.focusName ? ` at *${f.focusName}*` : '';
      // Never ask for a day here — the chrome under this reply is the job menu,
      // not day chips, and a question whose answer has nowhere to land is how
      // the "yes/no goes nowhere" complaint starts. Name the tap instead.
      return `Someone from the *${brand}* site team meets you${at} and walks you through — the units, the layout, the stage of work. Tap *Book a visit* and I'll put a slot on their calendar.`;
    }
    case 'count': {
      const where = f.markets.length ? ` across ${f.markets.slice(0, 3).join(', ')}` : '';
      const band =
        f.minDisplay && f.maxDisplay
          ? `, ${f.minDisplay} to ${f.maxDisplay}`
          : f.minDisplay
            ? `, from ${f.minDisplay}`
            : '';
      return `*${brand}* has ${f.total} ${f.total === 1 ? 'project' : 'projects'} on the book${where}${band}. Here they all are.`;
    }
    case 'cheapest':
      return f.cheapestName && f.minDisplay
        ? `The entry point on the book is *${f.cheapestName}* at ${f.minDisplay}. Here's the full list, cheapest first.`
        : `Here's the book with prices, cheapest first.`;
    case 'premium':
      return f.premiumName && f.maxDisplay
        ? `The top of the book is *${f.premiumName}* at ${f.maxDisplay}. Here's everything, so you can see where it sits.`
        : `Here's the book with prices so you can see the range.`;
    case 'not_on_book':
    case 'not_in_area': {
      // The buyer already suspects the answer and is testing whether we will
      // say it — hedging here costs more trust than hedging anywhere else. The
      // two cases need different sentences, though: a rival's project isn't
      // ours to carry, while an unserved locality is simply somewhere this
      // builder doesn't build. Answering the second with the first reads like
      // we dodged the question.
      const where = f.markets.length ? ` — ${f.markets.slice(0, 3).join(', ')}` : '';
      const band =
        f.minDisplay && f.maxDisplay ? `, ${f.minDisplay} to ${f.maxDisplay}` : '';
      const tail = `What I do have is ${f.total} ${f.total === 1 ? 'project' : 'projects'}${where}${band}. Here they are, in case something lands close.`;
      return q === 'not_in_area'
        ? `Nothing there, I'm afraid — *${brand}* doesn't build in that pocket, so I'd only be wasting your time pretending otherwise. ${tail}`
        : `That one isn't on this book — I only carry *${brand}*'s own projects, so if it isn't theirs I won't have it. ${tail}`;
    }
    case 'recommend_pick': {
      // Naming a favourite before knowing the size or the budget would be a
      // sales pitch, not a recommendation. Give the two ends — which is real
      // information — and ask for the one thing that makes a real pick possible.
      const ends =
        f.cheapestName && f.minDisplay && f.premiumName && f.maxDisplay
          ? ` The book runs from *${f.cheapestName}* at ${f.minDisplay} to *${f.premiumName}* at ${f.maxDisplay}.`
          : f.minDisplay && f.maxDisplay
            ? ` The book runs ${f.minDisplay} to ${f.maxDisplay}.`
            : '';
      return `Happy to pick — but picking well needs one thing from you first, because the right answer at ₹40 L is not the right answer at ₹1 Cr.${ends} Tell me a size or a budget and I'll come back with two or three, and say why each one.`;
    }
  }
}
