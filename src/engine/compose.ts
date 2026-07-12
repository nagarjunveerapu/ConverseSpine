import {
  formatDisclosedForPrompt,
  hasDisclosedRera,
} from './disclosed-facts.js';
import type { ComposeRequest, EvidenceSet, Match, ProbeKind, TurnGoal } from './types.js';
import { formatUnitConfigLine } from './unit-config.js';

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
    case 'probe':
      return `ask their ${g.slot}`;
    case 'recommend':
      return 'recommend matching projects from EVIDENCE';
    case 'clarify_project_pick':
      return 'ask which shortlisted project they want details on — do not invent a pick';
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
            (m) =>
              `  - ${m.name} — ${m.microMarket}${priceOf(m) ? `, from ${priceOf(m)}` : ''}`,
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
      `project: ${ev.detail.name} in ${ev.detail.microMarket}${ev.detail.startingPriceDisplay ? `, from ${ev.detail.startingPriceDisplay}` : ''}${ev.detail.reraNumber ? `, RERA ${ev.detail.reraNumber}` : ''}${ev.detail.possession ? `, possession ${ev.detail.possession}` : ''}${ev.detail.phaseNote ? `\n  phase status: ${ev.detail.phaseNote}` : ''}${ev.detail.summary ? `\n  summary: ${ev.detail.summary}` : ''}`,
    );
    if (ev.detail.faqs?.length) {
      out.push(
        `faqs (use these to answer the buyer's question — prefer over generic summary):\n${ev.detail.faqs
          .map((f) => `  - [${f.questionKey}] Q: ${f.question}\n    A: ${f.answer}`)
          .join('\n')}`,
      );
    }
  }
  if (ev.faqMiss?.keys.length) {
    out.push(`faq miss (no Desk row): ${ev.faqMiss.keys.join(', ')}`);
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
    case 'probe':
      return probeCopy(goal.slot);
    case 'recommend':
    case 'ack_reject_recommend': {
      const ms = (ev.matches ?? []).slice(0, 3);
      if (!ms.length) {
        return `I couldn't find a fresh match with those filters — tell me if you'd like to adjust area or budget?`;
      }
      const pre = goal.kind === 'ack_reject_recommend' ? 'No problem. ' : '';
      const list = ms
        .map((m) => `*${m.name}* in ${m.microMarket}${priceOf(m) ? `, from ${priceOf(m)}` : ''}`)
        .join('; ');
      return `${pre}Here's what fits: ${list}. Want details on any of these, or shall I set up a visit?`;
    }
    case 'clarify_project_pick': {
      const ms = (ev.matches ?? []).slice(0, 3);
      if (!ms.length) {
        return 'Which project should I open for details?';
      }
      const list = ms.map((m, i) => `${i + 1}) *${m.name}*`).join(', ');
      return `Which one should I open for details — ${list}?`;
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
        return `No *${g.requestedType}*${budget} on our books — closest fit is *${g.closestName}* from ${g.closestDisplay}. Want me to open *${g.closestName}*?`;
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
    case 'answer': {
      const topics = goal.topics?.length ? goal.topics : [goal.topic];

      // Over-answer fix — a primary "tell me about X" gets the compact card,
      // never the chunk assembly (and never FAQ text): sizes, one price band,
      // location, possession, one probing question. Facet asks fall through.
      if (topics[0] === 'overview' && ev.detail && !ev.detail.faqs?.length) {
        return overviewCard(ev.detail);
      }

      const chunks: string[] = [];

      if (topics.includes('price') && ev.pricing) {
        const p = ev.pricing;
        const parts = p.components.slice(0, 4).map(formatPriceComponent).join(', ');
        chunks.push(`*Pricing — ${p.projectName}:* ${parts || formatStartingPrice(p.startingDisplay) || 'on file'}`);
      }
      if (topics.includes('price') && ev.landedCost) {
        chunks.push(landedCostLine(ev.landedCost));
      }
      if (topics.includes('property_type') && ev.detail?.projectType) {
        chunks.push(projectTypeLine(ev.detail));
      }
      if (topics.includes('legal') && ev.detail && !ev.detail.faqs?.length) {
        // Prefer facet line (banks/EC) when buyer text asks; else snapshot.
        // When Desk FAQ hit exists, FAQ body below owns the answer (loan eligibility, etc.).
        chunks.push(
          focusedLegalLine(ev.detail, context.buyerText, context.disclosedFacts),
        );
      }
      if (topics.includes('location') && ev.location) {
        chunks.push(locationSnapshotLine(ev.location));
      }
      // Desk FAQ (loan eligibility, yield, …) beats EMI snapshot when both present.
      if (ev.detail?.faqs?.length) {
        const body = ev.detail.faqs
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

      if (goal.topic === 'price' && ev.landedCost) {
        return `${landedCostLine(ev.landedCost)}. Want anything else on *${ev.landedCost.projectName}*, or a visit?`;
      }
      if (goal.topic === 'price' && ev.pricing) {
        const p = ev.pricing;
        const parts = p.components.slice(0, 3).map(formatPriceComponent).join(', ');
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
          return `Here's the ${ev.media.title ?? ev.media.assetKind ?? 'asset'} for *${ev.media.projectName}*: ${ev.media.cdnUrl}`;
        }
        const pname = ev.media.projectName || context.focusProjectName || 'this project';
        const hint = (ev.media.redirectHint ?? ev.media.reason ?? '').trim();
        if (hint) {
          const alreadyNamed = pname !== 'this project' && hint.toLowerCase().includes(pname.toLowerCase());
          return alreadyNamed
            ? hint
            : `For *${pname}* — ${hint.replace(/^[—\-–]\s*/, '')}`;
        }
        return `I can share that after a site visit is confirmed for *${pname}*.`;
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
        const list = ev.units.slice(0, 4).map((u) => formatUnitConfigLine(u)).join('; ');
        const pname = ev.detail?.name ?? context.focusProjectName;
        const lead = pname ? `For *${pname}*: ` : '';
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

function locationSnapshotLine(l: import('./types.js').LocationEvidence): string {
  const bits: string[] = [`*${l.projectName}* is in ${l.microMarket}`];
  if (l.microMarketOverview) bits.push(l.microMarketOverview);
  if (l.connectivitySummary) bits.push(l.connectivitySummary);
  if (l.nearbyPois?.length) bits.push(`Nearby: ${l.nearbyPois.slice(0, 3).join(', ')}`);
  if (l.driveTimes?.length) bits.push(l.driveTimes.slice(0, 2).join('; '));
  return bits.join('. ');
}

function emiSnapshotLine(e: import('./types.js').EmiEvidence): string {
  const down = e.downPaymentFormatted ? ` (~${e.downPaymentFormatted} down on ${e.basisFormatted})` : '';
  return `Indicative EMI: *${e.emiFormatted}/month*${down} at ${e.ratePercent}% for ${e.tenureYears} years`;
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
  }
}

function priceOf(m: Match): string {
  return m.startingPriceDisplay || (m.startingPriceInr > 0 ? formatInr(m.startingPriceInr) : '');
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

const PERCENT_LABEL = /\b(?:duty|tax|gst|interest|charge[s]? \(%|percent|%)/i;

/**
 * Render a raw cost-sheet value for buyer copy.
 *   already formatted ("5% of land value", "Included", "₹39 L") → passthrough
 *   bare small number on a %-ish label ("Stamp Duty", "5")       → "5%"
 *   bare number ("15000", "499")                                 → "₹15,000" / "₹499"
 * Never invents units it can't infer (no /sqft guessing — honesty first).
 */
export function formatCostValue(label: string, raw: string): string {
  const v = (raw ?? '').trim();
  if (!v) return v;
  const bare = v.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(bare)) return v; // has words/symbols → already display-ready
  const n = Number(bare);
  if (!isFinite(n)) return v;
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
 */
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
  return `*${d.name}*${where}.${facts}${phase} Want pricing details, unit configurations, or the legal & RERA picture?`;
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
