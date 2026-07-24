import {
  formatDisclosedForPrompt,
  hasDisclosedRera,
} from './disclosed-facts.js';
import type {
  ComposeRequest,
  EvidenceSet,
  Match,
  ProbeKind,
  RelaxedDimension,
  TurnGoal,
} from './types.js';

/** Buyer-facing noun for a relaxed dimension — never their raw value. */
const RELAXED_NOUN: Record<RelaxedDimension, string> = {
  type: 'that property type',
  area: 'that area',
  size: 'that size',
  budget: 'that budget',
};

/**
 * Lead-in for a shortlist. A list that only exists because part of the ask was
 * relaxed is NOT a fit, and must not be announced as one — broadening exists so
 * the buyer is never dead-ended, not so we can overstate the match.
 */
function relaxedLead(relaxed: readonly RelaxedDimension[] | undefined): string {
  if (!relaxed?.length) return `Here's what fits`;
  const nouns = relaxed.map((r) => RELAXED_NOUN[r]).filter(Boolean);
  if (!nouns.length) return `Here's what fits`;
  const phrase =
    nouns.length === 1
      ? nouns[0]!
      : `${nouns.slice(0, -1).join(', ')} or ${nouns[nouns.length - 1]!}`;
  return `I couldn't match ${phrase} — here's what we do have`;
}
import { isInventoryAsk } from './facts.js';
import { formatUnitConfigLine } from './unit-config.js';
import { matchFitClauses, sensitivityLine } from './sensitivity.js';
import { speakEducation } from './education.js';

export function buildComposeRequest(
  goal: TurnGoal,
  evidence: EvidenceSet,
  ctx: Omit<ComposeRequest['context'], never> & ComposeRequest['context'],
): ComposeRequest {
  return { goal, evidence, context: ctx };
}

export function renderComposePrompt(req: ComposeRequest): string {
  const { goal, evidence, context } = req;
  const lines: string[] = [];
  lines.push(
    `You are a warm, concise WhatsApp property advisor for ${context.builderName || 'the builder'}.`,
  );
  lines.push(`Write ONE short reply (2-4 sentences, WhatsApp tone). No markdown headers or bullet dumps.`);
  lines.push(`This turn's GOAL: ${describeGoal(goal)}.`);
  if (req.vary) {
    // W3 — anti-repeat retry: the previous draft matched the last bot reply
    // verbatim (see PRIOR CONTEXT's excerpt). Same facts, fresh wording.
    lines.push(
      'IMPORTANT: your previous draft repeated the last bot reply word-for-word. Say it DIFFERENTLY and advance the conversation one concrete step.',
    );
  }
  if (req.repair?.unbacked.length) {
    // W1 — grounding retry: the checker rejected these exact values as not
    // present in EVIDENCE. One more draft, evidence-only.
    lines.push(
      `IMPORTANT: your previous draft was REJECTED — it stated ${req.repair.unbacked.join(', ')} which is NOT in EVIDENCE. Rewrite using ONLY values that appear verbatim in EVIDENCE; if a number isn't there, don't state one.`,
    );
  }
  lines.push('');
  lines.push('EVIDENCE — the ONLY facts you may state:');
  lines.push(renderEvidence(evidence));
  lines.push('');
  const priorBlock = renderPriorContext(context);
  if (priorBlock) {
    lines.push('PRIOR CONTEXT — already established (do not re-open as if new):');
    lines.push(priorBlock);
    lines.push('');
  }
  if (context.buyerName) lines.push(`Buyer's name: ${context.buyerName}.`);
  const c = context.constraints;
  const known = [
    c.location && `area ${c.location}`,
    c.bhk,
    c.budgetMaxInr && `budget ~${formatInr(c.budgetMaxInr)}`,
    c.purpose,
  ].filter(Boolean);
  if (known.length) lines.push(`Known so far: ${known.join(', ')}. Don't re-ask these.`);
  if (context.alreadyShownSameSet) {
    lines.push(`You already showed these exact projects — do NOT relist; advance the conversation.`);
  }
  if (context.buyerText && /\b(which.*better|better for)\b/i.test(context.buyerText)) {
    lines.push(
      `The buyer wants consultative guidance using ONLY the comparison facts — weigh trade-offs honestly, no invented claims.`,
    );
  }
  if (goal.kind === 'answer' && goal.topic === 'legal' && evidence.detail?.reraNumber) {
    const skipRera = hasDisclosedRera(context.disclosedFacts, goal.projectId);
    if (skipRera) {
      lines.push(
        `RERA was already shared — answer the buyer's specific legal facet (banks / EC / title) from EVIDENCE; do NOT re-lead with the full RERA dump or a location/price recap.`,
      );
    } else {
      lines.push(
        `Lead with RERA registration (${evidence.detail.reraNumber}) — do NOT give a generic location/price recap.`,
      );
    }
  }
  if (goal.kind === 'answer' && evidence.education) {
    lines.push(
      `The buyer asked a literacy/definition question — answer ONLY from evidence.education (platform curriculum). Do NOT search projects or invent locality.`,
    );
  }
  if (goal.kind === 'answer' && evidence.detail?.faqs?.length) {
    lines.push(
      `The buyer asked a specific FAQ — answer from the faqs in EVIDENCE first. Do NOT fall back to a generic location/price overview.`,
    );
  }
  if (goal.kind === 'answer' && evidence.faqMiss?.keys.length) {
    lines.push(
      `The buyer asked about ${evidence.faqMiss.keys.join(', ')} but there is NO FAQ answer in EVIDENCE. Say you don't have that detail on file yet — offer pricing, a site visit, or another facet. Do NOT invent payment plans, yields, loan terms, or possession dates.`,
    );
  }
  if (goal.kind === 'answer' && evidence.notices?.length) {
    lines.push(
      `These required facts are NOT in evidence and will be disclosed by the fixed failure speaker: ${evidence.notices.map((f) => f.subject).join(', ')}. Do NOT answer or substitute for them; answer only the supported required facts.`,
    );
  }
  if (goal.kind === 'answer' && goal.topics && goal.topics.length > 1) {
    lines.push(`Answer ALL of these in one reply: ${goal.topics.join(', ')}. Use only EVIDENCE for each.`);
  }
  if (goal.kind === 'answer' && evidence.detail?.name) {
    // W8 — facet answers must anchor WHICH project they're about (dev
    // re-baseline: correct pricing content that never said "Eldorado" reads
    // as unanchored, and multi-project chats lose the thread).
    lines.push(`Name the project (*${evidence.detail.name}*) once, naturally, in your reply.`);
  }
  lines.push('');
  lines.push('RULES: State ONLY facts in EVIDENCE. One natural next-step question. No filler closers.');
  return lines.join('\n');
}

function renderPriorContext(context: ComposeRequest['context']): string {
  const bits: string[] = [];
  if (context.priorTopics?.length) {
    bits.push(`Prior topics: ${context.priorTopics.join(', ')}.`);
  }
  if (context.priorReplyExcerpt) {
    bits.push(`Last bot reply (excerpt): ${context.priorReplyExcerpt}`);
  }
  const facts = formatDisclosedForPrompt(context.disclosedFacts);
  if (facts) bits.push(`Already disclosed:\n${facts}`);
  return bits.join('\n');
}

function describeGoal(g: TurnGoal): string {
  switch (g.kind) {
    case 'greet':
      return 'greet and ask what they are looking for';
    case 'orient':
      return 'briefly describe the portfolio and ask area/budget/size';
    case 'clarify_intent':
      return (
        'you did NOT understand what they asked. Say so plainly in one short line and ask ONE ' +
        'clarifying question. State NO facts, figures, places or claims of any kind — you have ' +
        'no evidence for this turn. Do not pitch the portfolio and do not guess what they meant'
      );
    case 'probe':
      return `ask their ${g.slot}`;
    case 'recommend':
      return 'recommend matching projects from EVIDENCE';
    case 'clarify_project_pick':
      return 'ask which shortlisted project they want details on — do not invent a pick';
    case 'shortlist_answer':
      return `answer their ${g.topic} question for EVERY shortlisted project from EVIDENCE — never ask which one to open`;
    case 'advance':
      return 'do NOT relist — nudge forward or ask one missing slot';
    case 'no_fit':
      return 'honestly say nothing fits and state the real starting point';
    case 'ack_reject_recommend':
      return 'acknowledge they passed on the last option and offer alternatives';
    case 'objection':
      return `acknowledge ${g.topic} concern and reframe using EVIDENCE angles only`;
    case 'answer':
      return `answer their ${g.topic} question from EVIDENCE`;
    case 'emi_calculate':
      return 'calculate EMI from the buyer-stated loan principal in EVIDENCE';
    case 'commit':
      return 'confirm their project choice and offer next step';
    case 'propose_visit':
      return 'offer to set up a site visit and ask which day works';
    case 'visit_ask':
    case 'visit_propose':
      return 'continue visit setup using the exact copy in EVIDENCE';
    case 'visit_booked':
      return 'confirm the visit is booked';
    case 'hold_propose':
      return 'offer to hold a unit — use the exact proposed copy';
    case 'hold_booked':
      return 'confirm the unit hold outcome — use the exact template';
    case 'visit_recall':
      return 'recall visits from EVIDENCE only';
    case 'warm_ack':
      return 'warm short ack after visit booked — no escalation';
    case 'handoff':
      return 'reassure a human will follow up';
    case 'smalltalk':
      return 'respond warmly and briefly, then gently ask what property they are looking for';
    default:
      return 'respond helpfully and steer back to property search';
  }
}

function renderEvidence(ev: EvidenceSet): string {
  const out: string[] = [];
  if (ev.matches?.length) {
    out.push(
      'matches:\n' +
        ev.matches
          .map(
            (m) => {
              const fit = matchFitClauses(m);
              return `  - ${m.name} — ${m.microMarket}${priceOf(m) ? `, ${fromPrice(priceOf(m))}` : ''}${fit ? ` (fit: ${fit})` : ''}`;
            },
          )
          .join('\n'),
    );
  }
  if (ev.floor) out.push(`catalog floor: ${ev.floor.display}`);
  if (ev.noMatch) out.push(`no exact match: ${ev.noMatch.reasoning}`);
  if (ev.catalog) {
    out.push(
      `portfolio: ${ev.catalog.projectTypes.join(', ')} in ${ev.catalog.microMarkets.slice(0, 5).join(', ')}`,
    );
  }
  if (ev.detail) {
    out.push(
      `project: ${ev.detail.name} in ${ev.detail.microMarket}${ev.detail.startingPriceDisplay ? `, ${fromPrice(ev.detail.startingPriceDisplay)}` : ''}${ev.detail.reraNumber ? `, RERA ${ev.detail.reraNumber}` : ''}${ev.detail.possession ? `, possession ${ev.detail.possession}` : ''}${ev.detail.phaseNote ? `\n  phase status: ${ev.detail.phaseNote}` : ''}${ev.detail.summary ? `\n  summary: ${ev.detail.summary}` : ''}`,
    );
    if (ev.detail.faqs?.length) {
      out.push(
        `faqs (use these to answer the buyer's question — prefer over generic summary):\n${ev.detail.faqs
          .map((f) => `  - [${f.questionKey}] Q: ${f.question}\n    A: ${f.answer}`)
          .join('\n')}`,
      );
    }
  }
  if (ev.education) {
    out.push(
      `buyer education [${ev.education.topicKey}/${ev.education.jurisdiction}]: ${ev.education.answer}` +
        (ev.education.whatToCheck ? `\n  check: ${ev.education.whatToCheck}` : '') +
        (ev.education.disclaimer ? `\n  disclaimer: ${ev.education.disclaimer}` : ''),
    );
  }
  if (ev.faqMiss?.keys.length) {
    out.push(`faq miss (no Desk row): ${ev.faqMiss.keys.join(', ')}`);
  }
  if (ev.notices?.length) {
    out.push(`required facts unavailable: ${ev.notices.map((f) => f.subject).join(', ')}`);
  }
  if (ev.location) {
    const l = ev.location;
    const bits = [
      l.microMarketOverview,
      l.connectivitySummary,
      l.nearbyPois?.length ? `nearby: ${l.nearbyPois.join('; ')}` : '',
      l.driveTimes?.length ? `drive times: ${l.driveTimes.join('; ')}` : '',
    ].filter(Boolean);
    out.push(`location for ${l.projectName}: ${bits.join(' | ') || l.microMarket}`);
    // S1 — Desk-verified POIs by category; asked categories first, top 3 each.
    // These are the ONLY named places allowed in a location answer.
    for (const f of locationCategoryFacts(l)) {
      out.push(`${f.label} near ${l.projectName}: ${f.pois.map(poiFactLine).join('; ')}`);
    }
  }
  if (ev.media) {
    out.push(
      ev.media.allowed
        ? `media: ${ev.media.title ?? ev.media.assetKind ?? 'asset'}${ev.media.cdnUrl ? ` → ${ev.media.cdnUrl}` : ''}`
        : `media withheld: ${ev.media.reason ?? ev.media.redirectHint ?? 'visit required'}`,
    );
  }
  if (ev.emi) {
    out.push(
      `emi: ${ev.emi.emiFormatted}/mo on ${ev.emi.basisFormatted} at ${ev.emi.ratePercent}% for ${ev.emi.tenureYears} yrs`,
    );
  }
  if (ev.units?.length) {
    out.push(
      `units:\n${ev.units
        .map((u) => `  - ${formatUnitConfigLine(u)}`)
        .join('\n')}`,
    );
  }
  if (ev.visits?.visits.length) {
    out.push(
      `visits:\n${ev.visits.visits.map((v) => `  - ${v.projectName}: ${v.label}${v.confirmed ? ' (confirmed)' : ''}`).join('\n')}`,
    );
  }
  if (ev.pricing) {
    out.push(
      `pricing for ${ev.pricing.projectName}: ${ev.pricing.components.map((c) => `${c.label} ${c.value}`).join('; ')}`,
    );
  }
  if (ev.compare?.tableText) out.push('comparison:\n' + ev.compare.tableText);
  if (ev.objection) {
    out.push(`ack: ${ev.objection.acknowledged}`);
    out.push(`reframe angles:\n${ev.objection.reframeAngles.map((a) => `  - ${a}`).join('\n')}`);
  }
  if (ev.nextSlot) out.push(`missing slot to ask: ${ev.nextSlot}`);
  return out.length ? out.join('\n') : '  (no data — ask a clarifying question, invent nothing)';
}

/** Buyer-facing phrase for a facet asked across the shortlist (honest-miss copy). */
function shortlistTopicLabel(topic: import('./types.js').AnswerTopic): string {
  switch (topic) {
    case 'price':
      return 'pricing';
    case 'emi':
      return 'EMI figures';
    case 'legal':
      return 'the legal papers';
    case 'availability':
      return 'availability';
    case 'location':
      return 'location details';
    case 'property_type':
      return 'the project type';
    default:
      return 'that';
  }
}

export function fallbackReply(req: ComposeRequest): string {
  const { goal, evidence: ev, context } = req;
  const name = context.buyerName ? ` ${context.buyerName}` : '';
  switch (goal.kind) {
    case 'greet': {
      const rb = context.returningBuyer;
      if (rb && rb.daysSinceLastSeen >= 1) {
        const welcome = rb.buyerName ? `Welcome back, ${rb.buyerName}!` : 'Welcome back!';
        return `${welcome} Still exploring property, or picking up where we left off?`;
      }
      return `Hi${name}! I can help you find the right property. What are you after — area, budget, or configuration?`;
    }
    case 'orient': {
      const types = ev.catalog?.projectTypes.join(', ') || 'homes';
      const from =
        ev.catalog && ev.catalog.priceMinInr > 0 ? `, starting from ${formatInr(ev.catalog.priceMinInr)}` : '';
      return `We have ${types} on our books${from}. Which area, budget, and size are you thinking?`;
    }
    case 'clarify_intent':
      // Acknowledge-then-orient: admit the miss, then ONE next-step question
      // that steers to the brief. Asserts nothing — this goal is only ever
      // reached with no evidence to speak from.
      return `I'd rather get that right than guess — could you tell me a bit more about what you're after, like the area, budget, or size you have in mind?`;
    case 'probe':
      return probeCopy(goal.slot);
    case 'recommend':
    case 'ack_reject_recommend': {
      const ms = (ev.matches ?? []).slice(0, 3);
      if (!ms.length) {
        return `I couldn't find a fresh match with those filters — tell me if you'd like to adjust area or budget?`;
      }
      const pre = goal.kind === 'ack_reject_recommend' ? 'No problem. ' : '';
      // Four-questions rendering: each match speaks its receipts (Q1 why +
      // Q2 trade-offs, fits-first, Desk note only as fallback), then the
      // shortlist speaks its sensitivity (Q3) once. Chips carry Q4.
      const list = ms
        .map((m) => {
          const fit = matchFitClauses(m);
          return `*${m.name}* in ${m.microMarket}${priceOf(m) ? `, ${fromPrice(priceOf(m))}` : ''}${fit ? ` — ${fit}` : ''}`;
        })
        .join('; ');
      const sensitivity = sensitivityLine(ms);
      const tail = sensitivity ? ` ${sensitivity}` : '';
      // Empty-locality widen names the asked place — buyer must know these are
      // nearby alternatives, not a fit for that locality.
      if (ev.localityWiden?.asked) {
        return `${pre}I don't have anything in *${ev.localityWiden.asked}* — here's what we have nearby: ${list}.${tail} Want details on any of these, or shall I set up a visit?`;
      }
      // Some part of the ask had to be relaxed for this list to exist, so it is
      // NOT a fit — say which dimension gave. Dimensions only, never the buyer's
      // raw values: a location capture may be dialogue noise.
      const lead = relaxedLead(ev.relaxed);
      return `${pre}${lead}: ${list}.${tail} Want details on any of these, or shall I set up a visit?`;
    }
    case 'clarify_project_pick': {
      const ms = (ev.matches ?? []).slice(0, 3);
      if (!ms.length) {
        return 'Which project should I open for details?';
      }
      const list = ms.map((m, i) => `${i + 1}) *${m.name}*`).join(', ');
      return `Which one should I open for details — ${list}?`;
    }
    case 'shortlist_answer': {
      const ms = (ev.matches ?? []).slice(0, 3);
      const facets = ev.shortlistFacet?.facets ?? [];
      const answered = facets.filter((f) => f.perProject.some((p) => p.value));
      if (!answered.length) {
        // Honest miss — an information ask never earns a bare pick-menu.
        const askLabel = facets[0]?.label.toLowerCase() ?? shortlistTopicLabel(goal.topic);
        const list = ms.map((m, i) => `${i + 1}) *${m.name}*`).join(', ');
        const fork = list ? ` Meanwhile, want the full picture on any of them — ${list}?` : '';
        return `I don't have ${askLabel} on file for your shortlist yet — I'll flag it to the team.${fork}`;
      }
      const blocks = answered.map(
        (f) =>
          `*${f.label}*\n${f.perProject
            .map((p) => `• *${p.name}* — ${p.value || 'not on file yet'}`)
            .join('\n')}`,
      );
      return `${blocks.join('\n\n')}\n\nWant the full picture on any one of them, or shall I set up a visit?`;
    }
    case 'advance': {
      // W2 — a focused bare-affirm ("ok"/"yes" with nothing pending) lands
      // here: nudge the DEAL forward, not the search. The search-flavored
      // copy below stays for the discover flow it was written for.
      if (context.focusProjectName) {
        return `Shall I set up a visit to *${context.focusProjectName}*, or hold a unit for you while you decide?`;
      }
      const lead = ev.matches?.[0]?.name;
      if (ev.nextSlot) return `Those are still the closest fits. ${probeCopy(ev.nextSlot)}`;
      return `Those are the ones that fit${lead ? ` — want full details on *${lead}*, or a site visit?` : '.'}`;
    }
    case 'no_fit': {
      const b = context.constraints.budgetMaxInr ? formatInr(context.constraints.budgetMaxInr) : 'that budget';
      if (ev.constraintGap) {
        const g = ev.constraintGap;
        const loc = g.location ? ` in *${g.location}*` : '';
        const budget = g.budgetDisplay ? ` at ${g.budgetDisplay}` : b !== 'that budget' ? ` at ${b}` : '';
        if (g.alternateProject && g.alternatePriceDisplay) {
          return `No *${g.bhk ?? 'that configuration'}*${budget}${loc} on our books — we do have *${g.alternateProject}* from ${g.alternatePriceDisplay}. Want me to open *${g.alternateProject}*?`;
        }
        return `No *${g.bhk ?? 'that configuration'}*${budget}${loc} on our books. Want to adjust BHK, budget, or area?`;
      }
      if (ev.budgetGap) {
        const g = ev.budgetGap;
        const loc = g.location ? ` in *${g.location}*` : '';
        return `Nothing${loc} starts within ${g.budgetDisplay} — closest on your brief is *${g.closestName}* from ${g.closestDisplay}. Want me to open *${g.closestName}*?`;
      }
      if (ev.propertyTypeGap) {
        const g = ev.propertyTypeGap;
        const budget = g.budgetDisplay ? ` at ${g.budgetDisplay}` : '';
        const loc = g.location ? ` in *${g.location}*` : '';
        return `No *${g.requestedType}*${budget}${loc} on our books — closest fit is *${g.closestName}* from ${g.closestDisplay}. Want me to open *${g.closestName}*?`;
      }
      if (ev.floor) {
        const lead = ev.floor.projectName ? ` with *${ev.floor.projectName}*` : '';
        const fork = ev.floor.projectName ? ` Want me to open *${ev.floor.projectName}*?` : ' Want the closest options?';
        return `Nothing sits within ${b} — options begin at ${ev.floor.display}${lead}.${fork}`;
      }
      if (ev.noMatch?.reasoning) {
        const emptyChips = ev.searchRecovery?.suggested_actions.length === 0;
        const suffix = emptyChips
          ? ' Tell me what to change — budget, area, or property type.'
          : '. Want to adjust budget, area, or property type?';
        const base = ev.noMatch.reasoning.endsWith('.') ? ev.noMatch.reasoning : `${ev.noMatch.reasoning}.`;
        return `${base}${suffix}`;
      }
      return `I don't have an exact match right now. Want to adjust budget or area?`;
    }
    case 'objection': {
      const o = ev.objection;
      const angle = o?.reframeAngles[0];
      const ack = o?.acknowledged ?? 'I hear you';
      return `${ack}.${angle ? ` ${angle}` : ' Let me get you specifics.'} Want the numbers or a site visit?`;
    }
    case 'emi_calculate':
      return ev.emi
        ? `${emiSnapshotLine(ev.emi)}. Want me to try another loan amount, rate, or tenure?`
        : 'I need a loan amount before I can calculate the EMI.';
    case 'answer': {
      const topics = goal.topics?.length ? goal.topics : [goal.topic];
      const unmet = new Set(ev.notices?.map((failure) => failure.subject) ?? []);
      const suppressPrice =
        unmet.has('carpet_area') || unmet.has('built_up_area');

      if (ev.education || topics.includes('education')) {
        if (ev.education) return speakEducation(ev.education);
        return "I don't have a short explainer for that yet — ask me about property types, buying steps, or buyer documents, or name a project.";
      }

      // Over-answer fix — a primary "tell me about X" gets the compact card,
      // never the chunk assembly (and never FAQ text): sizes, one price band,
      // location, possession, one probing question. Facet asks fall through.
      // A TAUGHT facet miss also falls through (to the honest-miss line): the
      // bind read the ask's meaning, so the card would answer a question the
      // buyer didn't ask. Text-bound misses keep today's card behaviour.
      if (topics[0] === 'overview' && ev.detail && !ev.detail.faqs?.length && !ev.faqMiss?.taught) {
        return overviewCard(ev.detail);
      }

      const chunks: string[] = [];

      if (topics.includes('price') && ev.pricing && !suppressPrice) {
        const p = ev.pricing;
        // AB-1 — an asked component ("club membership fee?") leads alone.
        const asked = componentsForAsk(context.buyerText ?? '', p.components);
        const shown = asked.length ? asked.slice(0, 4) : p.components.slice(0, 4);
        const parts = shown.map(formatPriceComponent).join(', ');
        chunks.push(`*Pricing — ${p.projectName}:* ${parts || formatStartingPrice(p.startingDisplay) || 'on file'}`);
      }
      if (topics.includes('price') && ev.landedCost && !suppressPrice) {
        chunks.push(landedCostLine(ev.landedCost));
      }
      if (topics.includes('property_type') && ev.detail?.projectType) {
        chunks.push(projectTypeLine(ev.detail));
      }
      // AB-8 — in a MULTI-topic ask the FAQ body carries the OTHER atom(s), so the
      // legal snapshot (RERA/khata) must still render rather than be swallowed by a
      // non-legal FAQ. "RERA and possession" was dropping RERA because a possession
      // FAQ was present. Single-topic behaviour is unchanged.
      const multiTopic = topics.length > 1;
      const faqPresent = !!ev.detail?.faqs?.length;
      // AB-8b — render the legal SNAPSHOT (RERA/khata) when no FAQ owns it, OR it's
      // a multi-topic ask, OR the buyer named a snapshot atom (RERA/khata/EC) that
      // the present FAQ does not answer. The last case rescues "is it RERA approved
      // AND can I get a loan?": both cues collapse to the single 'legal' topic, so
      // without it the loan FAQ rendered alone and the RERA atom was silently dropped.
      const snapshotAtomAsked =
        topics.includes('legal') &&
        !!ev.detail &&
        asksLegalSnapshotAtom(context.buyerText, ev.detail!.faqs ?? []);
      const legalSnapshotRendered =
        topics.includes('legal') && !!ev.detail && (!faqPresent || multiTopic || snapshotAtomAsked);
      if (legalSnapshotRendered) {
        // When the buyer named a TITLE atom (RERA/khata/EC) and a separate FAQ carries
        // the other legal atom (loan), render the title snapshot ONLY — focusedLegalLine
        // would pick the loan facet and drop RERA. Snapshot=RERA/khata, FAQ body=loan,
        // so both survive. Otherwise keep the facet-routed line (EC/banks/loan / full).
        chunks.push(
          snapshotAtomAsked
            ? legalTitleSnapshot(ev.detail!, ev.detail!.faqs ?? [])
            : focusedLegalLine(ev.detail!, context.buyerText, context.disclosedFacts),
        );
      }
      if (topics.includes('location') && ev.location) {
        chunks.push(locationSnapshotLine(ev.location));
      }
      // AB-8b — a structural atom the buyer explicitly named (configs → units,
      // EMI → schedule) must render as its OWN chunk when a FAQ body is also present,
      // or the FAQ shadows it. "configs and possession?" returned only the possession
      // FAQ; "2 BHK price and the EMI" only the loan FAQ. The FAQ is a DIFFERENT atom
      // and stays additive below. When no FAQ is present the richer single-topic
      // handlers further down own these — unchanged.
      if (faqPresent && topics.includes('availability') && ev.units?.length) {
        chunks.push(availabilityChunk(ev, context.buyerText ?? '', context.focusProjectName));
      }
      if (faqPresent && topics.includes('emi') && ev.emi) {
        chunks.push(emiSnapshotLine(ev.emi));
      }
      // Desk FAQ (loan eligibility, yield, …) beats EMI snapshot when both present.
      if (ev.detail?.faqs?.length) {
        // Drop only the FAQs the legal snapshot ALWAYS owns — RERA / khata /
        // rera_number — and only when that snapshot actually rendered. Keep loan/EMI
        // and everything else so a "RERA and home loan" ask keeps its loan atom.
        const relevant = legalSnapshotRendered
          ? ev.detail.faqs.filter((f) => !/^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i.test(f.questionKey))
          : ev.detail.faqs;
        const body = relevant
          .map((f) => f.answer.trim())
          .filter(Boolean)
          .join(' ');
        if (body) chunks.push(body);
      } else if (topics.includes('emi') && ev.emi) {
        chunks.push(emiSnapshotLine(ev.emi));
      }
      if (chunks.length > 1) {
        return `${chunks.join('\n\n')}. Want the full breakdown or a site visit?`;
      }
      if (chunks.length === 1) {
        return `${chunks[0]}. Want anything else on *${ev.detail?.name ?? ev.pricing?.projectName ?? 'this project'}*, or a visit?`;
      }

      if (goal.topic === 'price' && ev.landedCost && !suppressPrice) {
        return `${landedCostLine(ev.landedCost)}. Want anything else on *${ev.landedCost.projectName}*, or a visit?`;
      }
      if (goal.topic === 'price' && ev.pricing && !suppressPrice) {
        const p = ev.pricing;
        const asked = componentsForAsk(context.buyerText ?? '', p.components);
        const shown = asked.length ? asked.slice(0, 4) : p.components.slice(0, 3);
        const parts = shown.map(formatPriceComponent).join(', ');
        return `For *${p.projectName}*: ${parts || formatStartingPrice(p.startingDisplay) || 'pricing on file'}. Want the full breakdown or a visit?`;
      }
      if (goal.topic === 'property_type' && ev.detail?.projectType) {
        return `${projectTypeLine(ev.detail)} Want pricing, plot sizes, or a visit?`;
      }
      if (goal.topic === 'compare' && ev.compare?.tableText.trim()) {
        const advice = compareAdviceLine(context.buyerText ?? '', ev.compare.projects);
        return advice ? `${advice}\n\n${ev.compare.tableText.trim()}` : ev.compare.tableText.trim();
      }
      if (goal.topic === 'legal' && ev.detail) {
        return `${focusedLegalLine(ev.detail, context.buyerText, context.disclosedFacts)}. I can share the full approval checklist on a call or at your site visit.`;
      }
      if (goal.topic === 'location' && ev.location) {
        return `${locationSnapshotLine(ev.location)}. Want pricing, legal details, or a visit?`;
      }
      if (goal.topic === 'media' && ev.media) {
        if (ev.media.allowed && ev.media.cdnUrl) {
          return `Here's the ${ev.media.title ?? humanizeAsset(ev.media.assetKind)} for *${ev.media.projectName}*: ${ev.media.cdnUrl}`;
        }
        const pname = ev.media.projectName || context.focusProjectName || 'this project';
        // ev.media.redirectHint / reason are INTERNAL composer instructions — Desk
        // authors them for the RM ("offer site visit; do not quote this number"),
        // never as buyer copy (see NayaDesk disclosure.ts). Echoing one printed
        // "no floor_plan on file for this project yet — offer to follow up" to a
        // buyer. Translate the miss into buyer-safe copy; never recite the hint.
        return `I don't have the ${humanizeAsset(ev.media.assetKind)} for *${pname}* on file yet — I can walk you through the details here or share it at your site visit.`;
      }
      // Closed-beta: Desk FAQ (loan eligibility, yield, …) before EMI snapshot.
      if (ev.detail?.faqs?.length) {
        const pname = ev.detail.name || context.focusProjectName || 'this project';
        const body = ev.detail.faqs
          .map((f) => f.answer.trim())
          .filter(Boolean)
          .join(' ');
        if (body) {
          return `${body} Want anything else on *${pname}*, or a visit?`;
        }
      }
      if (goal.topic === 'emi' && ev.emi) {
        return `${emiSnapshotLine(ev.emi)}. Want the full cost breakdown or a visit?`;
      }
      if (goal.topic === 'availability' && ev.units?.length) {
        const pname = ev.detail?.name ?? context.focusProjectName;
        const lead = pname ? `For *${pname}*: ` : '';
        const list = ev.units.slice(0, 4).map((u) => formatUnitConfigLine(u)).join('; ');
        // AB-1 — an inventory ask ("is there any inventory left?") wants the
        // availability FACT. A config card list without it is a non-answer.
        if (isInventoryAsk(context.buyerText ?? '')) {
          const tracked = ev.units.filter((u) => (u.holdableUnits ?? 0) > 0);
          if (tracked.length) {
            const lines = tracked
              .slice(0, 4)
              .map((u) => `${u.holdableUnits} × ${u.unitType}`)
              .join(', ');
            return `Yes — still open${pname ? ` at *${pname}*` : ''}: ${lines}. Want me to hold one, or share pricing?`;
          }
          // All-zero counts can mean "not tracked" as much as "sold out" — Desk
          // sends 0 for every config when a project has no unit rows at all.
          // Never claim sold out without positive evidence; route the exact
          // count to the team instead.
          return `${lead}${list} are the configurations on offer — I don't have live unit-level counts here, our team confirms exact availability. Want me to check on a specific type?`;
        }
        return `${lead}Available configurations: ${list}. Want pricing on a specific size?`;
      }
      // SA-3: availability with empty units — honest empty, not generic overview.
      if (goal.topic === 'availability') {
        const pname = ev.detail?.name ?? context.focusProjectName ?? 'this project';
        return `Configuration details for *${pname}* aren't published yet — I can share pricing or book a visit to see options on site.`;
      }
      if (ev.faqMiss?.keys.length) {
        const pname = context.focusProjectName || 'this project';
        return `I don't have that detail on file for *${pname}* yet — I can share pricing, legal status, or set up a visit instead.`;
      }
      if (ev.detail) {
        // Overview fallthrough — the founder-spec card: sizes, one price
        // band (from configs), location, possession, one probing question.
        return overviewCard(ev.detail);
      }
      return `Let me get that confirmed and follow up shortly.`;
    }
    case 'commit':
      return `Great choice${name} — let's look at *${goal.projectName}*. Want pricing, legal status, or to line up a visit?`;
    case 'propose_visit':
      return `Happy to set up a visit. Which day works for you?`;
    case 'visit_ask':
    case 'visit_propose':
      return goal.copy;
    case 'visit_booked':
      return `Done — your visit to *${goal.projectName}* is set for ${goal.label}. Our team will confirm details before the day.`;
    case 'hold_propose':
      return goal.copy;
    case 'hold_booked':
      // W7 — three honest outcomes: held, queued (waitlist confirmed), or gone.
      if (goal.queued) {
        return `Done — you're ${goal.position && goal.position > 1 ? `#${goal.position} in line` : 'first in line'} for the next *${goal.unitType}* at *${goal.projectName}*. The moment one frees up it's auto-held for you and our team will call.`;
      }
      return goal.placed
        ? `Done — a *${goal.unitType}* at *${goal.projectName}* is held for you${goal.expiresLabel ? ` until ${goal.expiresLabel}` : ' for the next 24 hours'}. Our team will reach out to take it forward.`
        : `I'm sorry — the last *${goal.unitType}* at *${goal.projectName}* was just taken. Want me to check another configuration, or have our team call you about the waitlist?`;
    case 'visit_recall': {
      const vs = ev.visits?.visits ?? [];
      if (!vs.length) {
        return ev.visits?.siteVisitHours
          ? `I don't see a confirmed visit yet. Site visits are ${ev.visits.siteVisitHours} — want to book one?`
          : "I don't see a confirmed visit on file yet — want to set one up?";
      }
      const list = vs.map((v) => `*${v.projectName}* — ${v.label}${v.confirmed ? '' : ' (pending)'}`).join('; ');
      return `Your visits: ${list}. Our team will confirm details before the day.`;
    }
    case 'handoff':
      return `I'll have our team reach out directly on this — they'll take it from here.`;
    case 'warm_ack': {
      const name = context.buyerName ? `, ${context.buyerName}` : '';
      if (context.focusProjectName) {
        return `You're all set${name}! If anything else comes up on *${context.focusProjectName}* — pricing, legal, or another visit — just ask.`;
      }
      return `You're all set${name}! If anything else comes up — pricing, legal, or a visit — just ask.`;
    }
    case 'smalltalk':
      return `Doing well, thanks${name}! What kind of property are you exploring — area, budget, or configuration?`;
    default:
      return `Tell me the area, budget, or a project name and I'll pull live options from our catalog.`;
  }
}

function focusedLegalLine(
  d: import('./types.js').ProjectDetail,
  buyerText?: string,
  disclosedFacts?: ComposeRequest['context']['disclosedFacts'],
): string {
  const t = (buyerText ?? '').toLowerCase();
  if (/\b(?:ec|encumbrance)\b/i.test(t) && d.ecStatus) {
    return `For *${d.name}*, EC: ${d.ecStatus}`;
  }
  // banks / approved / loan — plurals and stems (not bare \bbank\b)
  if (/\b(?:banks?|loans?|approv\w*|lenders?|financ(?:e|ing))\b/i.test(t) && d.loanEligibility) {
    return `For *${d.name}*, home loan: ${d.loanEligibility}`;
  }
  // Skip repeat RERA only on banks/EC follow-ups — not broad "legal status".
  const facetFollowUp =
    /\b(?:ec|encumbrance|banks?|loans?|approv\w*|lenders?|financ(?:e|ing))\b/i.test(t);
  return legalSnapshotLine(d, true, facetFollowUp && hasDisclosedRera(disclosedFacts, d.projectId));
}

function legalSnapshotLine(
  d: import('./types.js').ProjectDetail,
  includeConfigs = true,
  skipRera = false,
): string {
  const bits: string[] = [];
  if (d.reraNumber && !skipRera) bits.push(`RERA: ${d.reraNumber}`);
  if (d.khata) bits.push(`Khata: ${d.khata}`);
  if (d.naStatus) bits.push(`NA: ${d.naStatus}`);
  if (d.ecStatus) bits.push(`EC: ${d.ecStatus}`);
  if (d.possession) bits.push(`Possession: ${d.possession}`);
  if (d.loanEligibility) bits.push(`Loan: ${d.loanEligibility}`);
  if (includeConfigs && d.configurations?.length) {
    const configs = d.configurations
      .slice(0, 4)
      .map((c) => formatUnitConfigLine(c))
      .join('; ');
    bits.push(`Configurations: ${configs}`);
  }
  if (bits.length) return `Regulatory snapshot for *${d.name}*: ${bits.join('. ')}`;
  return `Legal and title details for *${d.name}* are on file with our team`;
}

/**
 * AB-8b — the buyer named a legal SNAPSHOT atom (RERA/khata/title/EC) that the
 * present FAQ does not already answer. True lets compose render the title snapshot
 * alongside the FAQ body so a "is it RERA approved AND can I get a loan?" ask (both
 * cues collapse to the single 'legal' topic) keeps BOTH atoms. Bare "loan approval"
 * has no title cue, so a pure loan ask is unaffected.
 */
function asksLegalSnapshotAtom(
  text: string | undefined,
  faqs: ReadonlyArray<{ questionKey: string }>,
): boolean {
  if (!text) return false;
  // Title-atom cues only — phrase-scoped so a bare "loan approval" can't trip it.
  if (!/\b(?:rera|khata|title|encumbrance|\bec\b|clear\s+title|approval\s+status|plan\s+approval|legal\s+status|legal\s+details?)\b/i.test(text)) return false;
  // A legal-snapshot FAQ already carries this atom — the FAQ body answers it, no snapshot.
  const legalOwned = /^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i;
  return !faqs.some((f) => legalOwned.test(f.questionKey));
}

/** RERA/khata/title snapshot only — the other legal atom (loan) comes from the FAQ body. */
function legalTitleSnapshot(
  d: import('./types.js').ProjectDetail,
  faqs: ReadonlyArray<{ questionKey: string }>,
): string {
  const bits: string[] = [];
  if (d.reraNumber) bits.push(`RERA: ${d.reraNumber}`);
  if (d.khata) bits.push(`Khata: ${d.khata}`);
  if (d.naStatus) bits.push(`NA: ${d.naStatus}`);
  if (d.ecStatus) bits.push(`EC: ${d.ecStatus}`);
  // Loan only when no FAQ will carry it — avoids double-rendering the loan atom.
  const loanFaq = faqs.some((f) => /loan|financ|emi/i.test(f.questionKey));
  if (d.loanEligibility && !loanFaq) bits.push(`Loan: ${d.loanEligibility}`);
  return bits.length
    ? `Regulatory snapshot for *${d.name}*: ${bits.join('. ')}`
    : `Legal and title details for *${d.name}* are on file with our team`;
}

/**
 * AB-8b — config/inventory content for a MULTI-atom ask ("configs and possession"),
 * as a bare chunk (the assembly appends its own follow-up). Mirrors the single-topic
 * availability logic so a co-fetched FAQ can't shadow the configs the buyer asked for.
 */
function availabilityChunk(ev: EvidenceSet, buyerText: string, focusName?: string): string {
  const units = ev.units ?? [];
  const pname = ev.detail?.name ?? focusName;
  const lead = pname ? `For *${pname}*: ` : '';
  const list = units.slice(0, 4).map((u) => formatUnitConfigLine(u)).join('; ');
  if (isInventoryAsk(buyerText)) {
    const tracked = units.filter((u) => (u.holdableUnits ?? 0) > 0);
    if (tracked.length) {
      const lines = tracked.slice(0, 4).map((u) => `${u.holdableUnits} × ${u.unitType}`).join(', ');
      return `Still open${pname ? ` at *${pname}*` : ''}: ${lines}`;
    }
    // 0/absent counts are unknown, never "sold out" — route exact counts to the team.
    return `${lead}${list} are the configurations on offer — our team confirms exact unit-level availability`;
  }
  return `${lead}Available configurations: ${list}`;
}

function projectTypeLine(d: import('./types.js').ProjectDetail): string {
  return `*${d.name}* is a *${humanizeProjectType(d.projectType)}* project in ${d.microMarket}.`;
}

function humanizeProjectType(raw?: string): string {
  if (!raw) return 'residential';
  const s = raw.toLowerCase();
  if (s.includes('plot')) return 'plotted development';
  if (s.includes('plantation')) return 'managed plantation estate';
  if (s.includes('villa')) return 'villa project';
  if (s.includes('apartment')) return 'apartment project';
  return raw.replace(/_/g, ' ');
}

// Label words that carry no identity — every cost row has "charges"/"fee".
const COMPONENT_LABEL_NOISE = new Set([
  'charges', 'charge', 'fees', 'fee', 'cost', 'costs', 'price', 'amount', 'mandatory',
  'one', 'time', 'onetime', 'total', 'slot', 'per', 'with', 'and',
]);

/**
 * AB-1 — a cost-component ask gets THE component, not the whole card. "club
 * membership fee?" was answered with base price + parking + club + GST; the fact
 * asked for is one line of that. Matches buyer text against component labels by
 * significant token ("club", "parking", "stamp", "gst"); no match → [] and the
 * caller keeps the full card.
 */
export function componentsForAsk<T extends { label: string }>(
  text: string,
  components: readonly T[],
): T[] {
  const t = ` ${text.toLowerCase()} `;
  if (!t.trim()) return [];
  return components.filter((c) => {
    const tokens = c.label
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^a-z]+/)
      .filter((w) => (w.length >= 4 || w === 'gst' || w === 'plc') && !COMPONENT_LABEL_NOISE.has(w));
    return tokens.some((w) => new RegExp(`\\b${w}`, 'i').test(text));
  });
}

/**
 * AB-7 — generic property-TYPE taxonomy for a knowledge ask ("apartment or plot —
 * what's the difference?"). Universal real-estate knowledge (the LLD's sanctioned
 * template), NOT project- or place-specific data — never quotes a project or price.
 */
const TYPE_TAXONOMY: Record<string, string> = {
  apartment: 'an *apartment* is a home within a shared multi-storey building — you own the unit plus an undivided share of the land, with ready common amenities and a lower entry price',
  plot: 'a *plot* is a parcel of land in a gated layout — you own the land outright and build your own home when you choose; land value tends to track the area',
  villa: 'a *villa* is an independent house on its own land in a community — the space and privacy of land with a ready-built home',
  plantation: 'a *managed plantation estate* is titled farm land (coffee/pepper) with an operator running the estate on your behalf — a lifestyle asset that can earn crop revenue',
};

export function typeComparisonReply(types: readonly string[], investment: boolean): string {
  const lines = types
    .map((t) => TYPE_TAXONOMY[t])
    .filter(Boolean)
    .map((s) => `• ${s}`);
  if (lines.length < 2) {
    return 'Happy to explain the property types — which two are you weighing (apartment, plot, villa, or plantation)?';
  }
  const head = `Great question — the core difference:\n${lines.join('\n')}`;
  const tail = investment
    ? '\n\nOn returns: apartments are usually held for rental income, plots/land for appreciation, and plantation estates for crop revenue — the right fit depends on your horizon and how hands-on you want to be. Want me to show options in either?'
    : '\n\nWant me to show options in either?';
  return head + tail;
}

/** Buyer-facing name for a media asset kind — never an underscored key like `floor_plan`. */
function humanizeAsset(kind?: string): string {
  if (!kind) return 'document';
  const nice: Record<string, string> = {
    floor_plan: 'floor plan',
    master_plan: 'master plan',
    layout_plan: 'layout plan',
    brochure: 'brochure',
    price_sheet: 'price sheet',
    cost_sheet: 'cost sheet',
    payment_plan: 'payment plan',
    site_image: 'site photos',
    site_plan: 'site plan',
    video: 'walkthrough video',
    photo: 'photos',
  };
  return nice[kind] ?? kind.replace(/_/g, ' ');
}

function formatPriceComponent(c: { label: string; value: string }): string {
  const label = c.label.trim();
  let value = c.value.trim();
  if (/^starting from$/i.test(label)) {
    value = value.replace(/^from\s+/i, '').trim();
    return `Starting from ${value}`;
  }
  return `${label} ${value}`.replace(/\s+/g, ' ').trim();
}

function formatStartingPrice(display?: string): string {
  if (!display) return '';
  return display.replace(/^from\s+/i, '').trim();
}

/** Buyer-facing label per LI category (S1). Iteration order = render order. */
const LOCATION_CATEGORY_LABELS: ReadonlyArray<
  [import('./types.js').LocationCategoryKey, string]
> = [
  ['schools', 'Schools'],
  ['hospitals', 'Hospitals'],
  ['metroStations', 'Metro'],
  ['airports', 'Airport'],
  ['itParks', 'IT parks'],
  ['malls', 'Malls'],
  ['transitStations', 'Rail/bus'],
  ['universities', 'Colleges'],
  ['supermarkets', 'Supermarkets'],
  ['parks', 'Parks'],
];

function poiFactLine(p: import('./types.js').LocationPoi): string {
  const parts = [p.name];
  if (p.distanceKm !== undefined) parts.push(`${p.distanceKm} km`);
  if (p.driveMinutes !== undefined) parts.push(`~${p.driveMinutes} min drive`);
  return parts.join(', ');
}

/**
 * Desk-verified POIs by category — asked categories first with up to 3 places,
 * unasked context capped at 2 (S1). Empty categories are skipped so the
 * composer never sees an answerable-looking header with nothing behind it.
 */
function locationCategoryFacts(
  l: import('./types.js').LocationEvidence,
): Array<{ key: import('./types.js').LocationCategoryKey; label: string; pois: import('./types.js').LocationPoi[] }> {
  const asked = l.askedCategories ?? [];
  const orderedKeys = [
    ...asked,
    ...LOCATION_CATEGORY_LABELS.map(([k]) => k).filter((k) => !asked.includes(k)),
  ];
  const out: Array<{ key: import('./types.js').LocationCategoryKey; label: string; pois: import('./types.js').LocationPoi[] }> = [];
  for (const key of orderedKeys) {
    const pois = l[key];
    if (!pois?.length) continue;
    const label = LOCATION_CATEGORY_LABELS.find(([k]) => k === key)?.[1] ?? key;
    const cap = asked.length === 0 || asked.includes(key) ? 3 : 2;
    out.push({ key, label, pois: pois.slice(0, cap) });
  }
  return out;
}

/** Exported for tests. */
export function locationSnapshotLine(l: import('./types.js').LocationEvidence): string {
  const bits: string[] = [`*${l.projectName}* is in ${l.microMarket}`];
  const asked = l.askedCategories ?? [];
  if (asked.length) {
    // The buyer asked about specific POI categories — answer those with named,
    // Desk-verified places (S1), not a generic connectivity recap.
    const askedFacts = locationCategoryFacts(l).filter((f) => asked.includes(f.key));
    for (const f of askedFacts.slice(0, 2)) {
      bits.push(`${f.label} nearby: ${f.pois.map(poiFactLine).join('; ')}`);
    }
    if (askedFacts.length) return bits.join('. ');
  }
  if (l.microMarketOverview) bits.push(l.microMarketOverview);
  if (l.connectivitySummary) bits.push(l.connectivitySummary);
  if (l.nearbyPois?.length) bits.push(`Nearby: ${l.nearbyPois.slice(0, 3).join(', ')}`);
  if (l.driveTimes?.length) bits.push(l.driveTimes.slice(0, 2).join('; '));
  return bits.join('. ');
}

function emiSnapshotLine(e: import('./types.js').EmiEvidence): string {
  if (!e.discloseInputs) {
    const down = e.downPaymentFormatted
      ? ` (~${e.downPaymentFormatted} down on ${e.basisFormatted})`
      : '';
    return `Indicative EMI: *${e.emiFormatted}/month*${down} at ${e.ratePercent}% for ${e.tenureYears} years`;
  }
  if (e.basisKind === 'explicit_principal') {
    return `Indicative EMI: *${e.emiFormatted}/month* on a ${e.principalFormatted} loan at ${e.ratePercent}% for ${e.tenureYears} years`;
  }
  const ltv = e.ltvPercent ?? 80;
  const down = e.downPaymentFormatted ? `; ~${e.downPaymentFormatted} down` : '';
  return `Indicative EMI: *${e.emiFormatted}/month* on a ${ltv}% loan (${e.principalFormatted} principal${down}) against ${e.basisFormatted} project price, at ${e.ratePercent}% for ${e.tenureYears} years`;
}

function landedCostLine(lc: import('./types.js').LandedCostEvidence): string {
  const oneTime = lc.oneTime
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.display}`)
    .join('; ');
  const base = `*Cost breakdown — ${lc.projectName} (${lc.unitType}):* base ${lc.baseDisplay}`;
  const charges = oneTime ? `; ${oneTime}` : '';
  const total = lc.totalDisplay ? `; all-in ~${lc.totalDisplay}` : '';
  return `${base}${charges}${total}`;
}

function compareAdviceLine(
  buyerText: string,
  projects: Array<{ name?: string; starting_price_lakhs?: number; possession_date?: string }>,
): string {
  if (projects.length < 2) return '';
  const [a, b] = projects;
  if (/\bbudget\b/i.test(buyerText)) {
    const sorted = [...projects].sort(
      (x, y) => (x.starting_price_lakhs ?? 0) - (y.starting_price_lakhs ?? 0),
    );
    const lead = sorted[0];
    const next = sorted[1];
    if (lead?.name && next?.name) {
      const leadPrice =
        lead.starting_price_lakhs && lead.starting_price_lakhs > 0
          ? formatInr(Math.round(lead.starting_price_lakhs * 100_000))
          : '';
      const nextPrice =
        next.starting_price_lakhs && next.starting_price_lakhs > 0
          ? formatInr(Math.round(next.starting_price_lakhs * 100_000))
          : '';
      return `On your budget, *${lead.name}*${leadPrice ? ` starts lower at ${leadPrice}` : ' is the lower entry point'}${nextPrice ? `; *${next.name}* from ${nextPrice}` : `; *${next.name}* is the next step up`}. Both are on your board — tap one for full pricing.`;
    }
  }
  if (/\binvest/i.test(buyerText)) {
    const cheaper =
      (a?.starting_price_lakhs ?? 0) <= (b?.starting_price_lakhs ?? 0) ? a : b;
    return `For investment, *${cheaper?.name}* has the lower entry point on our catalog — happy to walk through yields on a call.`;
  }
  if (/\bfamil/i.test(buyerText)) {
    return `For families, compare location fit and configuration — both are in the table below. Tell me your must-haves and I can steer you.`;
  }
  return '';
}

function probeCopy(slot: ProbeKind): string {
  switch (slot) {
    case 'location':
      return 'Which area or part of the city are you looking in?';
    case 'budget':
      return 'What budget range are you working with?';
    case 'bhk':
      return 'How many bedrooms — 2 BHK, 3 BHK, something else?';
    case 'purpose':
      return 'Is this for you to live in, or as an investment?';
    case 'priority':
      return 'One quick thing so I rank these right — does a shorter commute matter more, or staying on budget?';
  }
}

function priceOf(m: Match): string {
  return m.startingPriceDisplay || (m.startingPriceInr > 0 ? formatInr(m.startingPriceInr) : '');
}

/**
 * Prefix a starting-price display with "from " ONLY when it is a single figure.
 * A band ("25-50L", "₹1.2Cr onwards", "₹499–650/sqft") is a range already, so
 * "from 25-50L" is wrong — render the band verbatim. Honesty-first: never
 * reformat or parse the band, just decide whether "from " is truthful.
 */
export function fromPrice(display?: string): string {
  const v = (display ?? '').trim();
  if (!v) return '';
  if (/[-–—/+]|\bto\b|onwards/i.test(v)) return v; // already a range/open-ended
  return `from ${v}`;
}

export function formatInr(inr: number): string {
  if (!isFinite(inr) || inr <= 0) return '';
  if (inr >= 10_000_000) return `₹${(inr / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  return `₹${(inr / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`;
}

// ── W4 — format once, at the adapter (templates stay dumb) ──────────────────
// Desk cost-sheet values arrive raw ("499", "5", "15000") and were dumped into
// replies verbatim ("Base land price 499, Stamp Duty 5"). Everything the
// adapter maps into evidence goes through these; no template formats anything.

const PERCENT_LABEL = /\b(?:duty|tax|gst|interest|percent|%)/i;

/**
 * Render a raw cost-sheet value for buyer copy.
 *
 * Desk ships each cost row as {value, kind} where `kind` IS the unit
 * ('per_sqft' | 'percent' | 'flat' | 'info'). When kind is present it is
 * authoritative — we format by it and never guess. This is the fix for the
 * "₹499" bug: Ayana's base land price is kind='per_sqft', value='499', i.e.
 * ₹499/sqft — rendering the bare number as a ₹ total was wrong.
 *
 * Only when kind is absent (older payloads) do we fall back to the honesty-
 * first label heuristic, which never invents a "/sqft" it can't infer:
 *   already formatted ("5% of land value", "Included", "₹39 L") → passthrough
 *   bare small number on a %-ish label ("Stamp Duty", "5")       → "5%"
 *   bare number ("15000")                                         → "₹15,000"
 */
export function formatCostValue(label: string, raw: string, kind?: string): string {
  const v = (raw ?? '').trim();
  if (!v) return v;
  const bare = v.replace(/,/g, '');
  const isNumeric = /^\d+(?:\.\d+)?$/.test(bare);
  const n = isNumeric ? Number(bare) : NaN;

  const k = kind?.trim().toLowerCase();
  if (k) {
    if (k === 'info') return v; // free text — already display-ready
    if (!isNumeric || !isFinite(n)) return v; // pre-formatted value → passthrough
    if (k === 'per_sqft') return `₹${n.toLocaleString('en-IN')}/sqft`;
    if (k === 'percent') return `${v}%`;
    if (k === 'flat') return n >= 100_000 ? formatInr(n) : `₹${n.toLocaleString('en-IN')}`;
    // unknown kind → fall through to the label heuristic below
  }

  if (!isNumeric || !isFinite(n)) return v; // has words/symbols → already display-ready
  if (n > 0 && n <= 30 && PERCENT_LABEL.test(label)) return `${v}%`;
  if (n >= 100_000) return formatInr(n);
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * Possession strings are builder free text ("Ready to register", "Phase-wise;
 * Dioro & Beryl: June 2028. Earlier phases ready for possession..") and were
 * shoved into "possession {x}" sentences with double periods and run-ons.
 * Normalise: collapse repeated periods, strip the trailing one, and keep only
 * the first clause when the note runs long (the full text lives in FAQs).
 */
export function formatPossession(raw: string): string {
  let s = (raw ?? '').trim().replace(/\.{2,}/g, '.').replace(/\.$/, '');
  if (s.length > 60) {
    // Keep the first SENTENCE — "Phase-wise; Dioro & Beryl: June 2028" holds
    // the date a buyer needs; the trailing prose lives in FAQs.
    const cut = s.indexOf('.');
    if (cut > 10) s = s.slice(0, cut);
  }
  return s.trim();
}

/**
 * W7 — one buyer-ready phase caveat from the Desk journey composer's per-phase
 * output. RERA registers PER PHASE: a pre-RERA phase may take holds/EOI but no
 * booking money, and the bot must say so instead of being phase-blind. Only
 * the caveat-worthy case renders — fully registered projects get ''.
 */
export function phaseNoteFrom(
  journeys: Array<{ phase_label: string; money_allowed: boolean; primary?: string }> | undefined,
): string {
  if (!journeys?.length) return '';
  const gated = journeys.filter((j) => !j.money_allowed);
  if (gated.length === 0) return '';
  const g = gated.find((j) => j.primary) ?? gated[0]!;
  const scope = journeys.length === 1 ? 'This phase' : `${g.phase_label}`;
  return `${scope} is pre-RERA — booking opens at registration; holds and expressions of interest are available now.`;
}

/**
 * One price BAND truth (over-answer fix): low–high derived from the configs —
 * the same rows the search rail's starting price comes from, so the overview
 * card can never contradict the recommend line. Falls back to the configured
 * band string only when no config carries a price.
 */
export function priceBandDisplayFrom(
  configs: Array<{ priceMinInr: number; priceMaxInr?: number }>,
  fallbackBand: string | undefined,
): string {
  const mins = configs.map((c) => c.priceMinInr).filter((n) => isFinite(n) && n > 0);
  const maxs = configs.map((c) => c.priceMaxInr ?? 0).filter((n) => isFinite(n) && n > 0);
  if (mins.length) {
    const lo = formatInr(Math.min(...mins));
    const hi = maxs.length ? formatInr(Math.max(...maxs, Math.max(...mins))) : '';
    return hi && hi !== lo ? `${lo} – ${hi}` : `from ${lo}`;
  }
  return (fallbackBand ?? '').trim();
}

/**
 * The founder-specified project overview card — what "tell me about X" says:
 * name + location, the configuration types, ONE price band (low–high, from
 * configs), possession — then exactly one probing question. Never the FAQ
 * catalog; facet questions get facet answers on the next turn.
 *
 * Catalog-first: the one narrative line comes from the catalog's own summary
 * field (a tab the builder maintains), never from FAQ rows — capped and cut
 * at a sentence boundary so the card stays a card.
 */
const SUMMARY_BLURB_CAP = 220;

export function summaryBlurb(summary: string | undefined): string {
  const s = (summary ?? '').replace(/\s+/g, ' ').trim();
  // Too short to be a real narrative (empty, or a stray token) — skip.
  if (s.length < 20) return '';
  let out = s;
  if (out.length > SUMMARY_BLURB_CAP) {
    const cut = out.slice(0, SUMMARY_BLURB_CAP);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '));
    out = lastStop > 60 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  }
  if (!/[.!…?]$/.test(out)) out = `${out}.`;
  return ` ${out}`;
}

export function overviewCard(d: NonNullable<EvidenceSet['detail']>): string {
  const cfgs = d.configurations ?? [];
  const types = cfgs.map((c) => c.unitType).filter(Boolean);
  const typesLine = types.length
    ? types.length > 1
      ? `${types.slice(0, -1).join(', ')} & ${types[types.length - 1]}`
      : types[0]!
    : '';
  const band = priceBandDisplayFrom(cfgs, d.startingPriceDisplay);
  const bits = [typesLine, band, d.possession ? `possession ${d.possession}` : ''].filter(Boolean);
  const where = d.microMarket ? ` — ${d.microMarket}` : '';
  const facts = bits.length ? ` ${bits.join(' · ')}.` : '';
  const phase = d.phaseNote ? ` ${d.phaseNote}.` : '';
  const blurb = summaryBlurb(d.summary);
  return `*${d.name}*${where}.${facts}${phase}${blurb} Want pricing details, unit configurations, or the legal & RERA picture?`;
}

/**
 * ONE starting-price truth (LLD W4): the minimum configuration price, same
 * number the search rail shows — so "from ₹31 L" on the recommend line and
 * the detail line can never disagree. The configured band is the fallback
 * when no config carries a price, prefixed so it reads as a range.
 */
export function startingPriceDisplayFrom(
  configMinsInr: number[],
  entryPriceBand: string | undefined,
): string {
  const mins = configMinsInr.filter((n) => isFinite(n) && n > 0);
  if (mins.length) return formatInr(Math.min(...mins));
  const band = (entryPriceBand ?? '').trim();
  return band;
}

export function minimumBudgetReply(
  typeLabel: string,
  floor: { name: string; display: string },
  buyerBudgetMaxInr?: number,
): string {
  const briefBit = buyerBudgetMaxInr ? ` Your brief is ${formatInr(buyerBudgetMaxInr)}.` : '';
  return `${typeLabel}s on our books start from *${floor.display}* (*${floor.name}*).${briefBit} Pick an option below to adjust area, budget, or property type.`;
}
