/**
 * Channel-gated buyer voice — WhatsApp stays short/procedural; advisor_web
 * is consultative (no "Reply yes to confirm" chrome). Facts unchanged.
 */
export type BuyerChannel = 'whatsapp' | 'advisor_web';

export function isAdvisorWeb(channel?: string | null): boolean {
  return channel === 'advisor_web';
}

/** Propose a firm visit slot. */
export function visitProposeConfirmCopy(input: {
  channel?: string | null;
  label: string;
  projectName: string;
  driveNote?: string;
  queuedNote?: string;
  prefix?: string;
  /** Soft reconfirm after time edit. */
  justConfirm?: boolean;
}): string {
  const drive = input.driveNote ?? '';
  const queued = input.queuedNote ?? '';
  const prefix = (input.prefix ?? '').trim();
  const lead = prefix ? `${prefix} ` : '';

  if (isAdvisorWeb(input.channel)) {
    if (input.justConfirm) {
      return `${lead}I can hold *${input.label}* for *${input.projectName}* — shall I lock that in?`.trim();
    }
    const tail = [drive.trim(), queued.trim()].filter(Boolean).join(' ');
    const core = `I can hold *${input.label}* for your visit to *${input.projectName}*`;
    if (tail) return `${lead}${core}. ${tail} Shall I lock that in?`.trim();
    return `${lead}${core} — shall I lock that in?`.trim();
  }

  if (input.justConfirm) {
    return `Just to confirm — shall I block *${input.label}* for your visit to *${input.projectName}*? Reply yes.`;
  }
  const waTail = [drive.trim(), queued.trim()].filter(Boolean).join(' ');
  const waCore = `shall I block *${input.label}* for your visit to *${input.projectName}*?`;
  if (waTail) return say(lead, `${waCore} ${waTail} Reply yes to confirm.`);
  return say(lead, `${waCore} Reply yes to confirm.`);
}

export function visitForceTeamConfirmCopy(input: {
  channel?: string | null;
  prefix: string;
  proposeLabel: string;
  projectName: string;
}): string {
  const base = input.prefix.trim();
  if (isAdvisorWeb(input.channel)) {
    return `${base} First firm slot: *${input.proposeLabel}* for *${input.projectName}*. Shall I lock in the firm stop(s)?`.replace(
      /^\s+/,
      '',
    );
  }
  return `${base} First firm slot: *${input.proposeLabel}* for *${input.projectName}*. Reply yes to confirm the firm stop(s).`.replace(
    /^\s+/,
    '',
  );
}

/** After chooser pick — lead into origin ask. */
export function visitChooserPlanPrefix(
  channel: string | null | undefined,
  bothOrAll: 'both' | 'all',
): string {
  if (isAdvisorWeb(channel)) {
    return `Happy to plan ${bothOrAll}. To sequence the stops sensibly, `;
  }
  return `Happy to plan ${bothOrAll} — `;
}

export function visitOriginAskCopy(channel: string | null | undefined, stopCount: number): string {
  if (isAdvisorWeb(channel)) {
    return `where will you start from that day? I'll sequence the ${stopCount} stops from there.`;
  }
  return `where will you be coming from that day? I'll sequence the ${stopCount} stops sensibly from there.`;
}

export function visitDayAskCopy(channel: string | null | undefined, projectName: string): string {
  if (isAdvisorWeb(channel)) {
    return `which day works for *${projectName}*? (e.g. Saturday morning, or Monday 11am)`;
  }
  return `Which day works for your visit to *${projectName}*? (e.g. Saturday, tomorrow)`;
}

function say(prefix: string, sentence: string): string {
  const p = prefix.trim();
  if (!p) {
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }
  return `${p}${sentence}`;
}
