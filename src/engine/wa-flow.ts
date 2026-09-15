/**
 * WhatsApp Flow jobs — chrome in, canonical utterance out.
 *
 * Completing a Flow is the same as typing. Visit FSM, which-projects chooser,
 * origin, and brief extractors already own the words. This file does not add
 * regex for open speech.
 */

export const WA_FLOW_KINDS = [
  'visit',
  'stops',
  'origin',
  'brief',
  'kyc',
  'applicant',
  'loan',
  'agreement',
  'regdate',
  'receipt',
] as const;

export type WaFlowKind = (typeof WA_FLOW_KINDS)[number];

export const WA_FLOW_SCREEN: Record<WaFlowKind, string> = {
  visit: 'VISIT_DAY',
  stops: 'STOPS',
  origin: 'ORIGIN',
  brief: 'BRIEF',
  kyc: 'KYC',
  applicant: 'APPLICANT',
  loan: 'LOAN',
  agreement: 'AGREEMENT',
  regdate: 'REG_DAY',
  receipt: 'RECEIPT',
};

function isKind(v: string): v is WaFlowKind {
  return (WA_FLOW_KINDS as readonly string[]).includes(v);
}

function jobOf(o: Record<string, unknown>): WaFlowKind | undefined {
  const raw =
    (typeof o.job === 'string' && o.job) ||
    (typeof o.flow_token === 'string' && o.flow_token) ||
    '';
  const head = raw.split(':')[0]!.trim();
  return isKind(head) ? head : undefined;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function joinAnd(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function visitUtterance(dateIso: string, timeText: string): string {
  return `${dateIso} at ${timeText.trim()}`;
}

function fromDateTime(o: Record<string, unknown>): string | undefined {
  const date =
    (typeof o.date === 'string' && o.date) ||
    (typeof o.appointment_date === 'string' && o.appointment_date) ||
    '';
  const time = str(o.time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return undefined;
  return visitUtterance(date, time);
}

/** nfm_reply.response_json → buyer text. Junk / missing required fields → undefined (drop the webhook). */
export function utteranceFromNfmReply(responseJson: string | undefined): string | undefined {
  if (!responseJson?.trim()) return undefined;
  try {
    const o = JSON.parse(responseJson) as Record<string, unknown>;
    const job = jobOf(o);

    if (job === 'stops' || (!job && strList(o.stops).length > 0)) {
      const stops = strList(o.stops);
      if (o.all === true || str(o.all) === 'true') return 'all of them';
      return joinAnd(stops) || undefined;
    }
    if (job === 'origin') return str(o.origin) || undefined;
    if (job === 'brief') {
      const bhk = str(o.bhk);
      const area = str(o.area);
      const budget = str(o.budget);
      if (!bhk || !area || !budget) return undefined;
      return `${bhk} in ${area}, ${budget}`;
    }
    if (job === 'kyc') {
      if (!o.pan && !o.aadhaar && !o.address && !o.photographs) return undefined;
      return 'PAN, Aadhaar and photographs uploaded';
    }
    if (job === 'applicant') {
      const name = str(o.name);
      const pan = str(o.pan) || str(o.panNo);
      if (!name) return undefined;
      return pan ? `${name}, PAN ${pan}` : name;
    }
    if (job === 'loan') {
      const bank = str(o.bank);
      if (!bank) return undefined;
      const app = str(o.app_no) || str(o.appNo);
      return app ? `loan through ${bank}, application ${app}` : `loan through ${bank}`;
    }
    if (job === 'agreement') {
      if (!o.signed && !o.file) return undefined;
      return 'signed agreement uploaded';
    }
    if (job === 'receipt') {
      if (!o.receipt && !o.file) return undefined;
      return 'registration receipt uploaded';
    }
    if (job === 'regdate') {
      const slot = fromDateTime(o);
      if (!slot) return undefined;
      // Human date, not ISO — parseVisitSlot would otherwise book a site visit.
      const [iso, ...rest] = slot.split(' at ');
      const time = rest.join(' at ');
      const [y, m, d] = (iso ?? '').split('-').map(Number);
      if (!y || !m || !d) return undefined;
      const when = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return `sub-registrar on ${when} at ${time}`;
    }

    return fromDateTime(o);
  } catch {
    return undefined;
  }
}
