/**
 * The console's own voice — authored screens for the WhatsApp buyer console.
 *
 * The engine's compose layer writes for free-text web chat, where closers,
 * hedges and over-answering are survival habits. A tapped console screen is a
 * different medium: the buyer asked exactly one thing by id, so the screen
 * says exactly that thing — cut from the same ProjectDetail the honest menu
 * gate read, so a row that was drawn can never open onto "I don't have it".
 *
 * Free text still falls through to compose untouched; this module only speaks
 * when the turn was a console tap it owns.
 */
import type { ProjectDetail, TurnGoal } from '../engine/types.js';
import {
  splitProjectStamp,
  WA_MENU_NODE,
  WA_NODE_LATER,
  WA_NODE_LIFE,
  WA_NODE_PLACE,
  WA_NODE_TIME,
  WA_NODE_TRUST,
} from './wa-pack.js';

const NODE_IDS = new Set([WA_NODE_TRUST, WA_NODE_PLACE, WA_NODE_LIFE, WA_NODE_TIME, WA_NODE_LATER, WA_MENU_NODE]);

export function isWaNodeTap(actionId: string | undefined): boolean {
  if (!actionId) return false;
  return NODE_IDS.has(splitProjectStamp(actionId.trim()).aid);
}

function line(label: string, value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? `*${label}:* ${v}` : undefined;
}

function pois(label: string, list: Array<{ name: string; driveMinutes?: number; distanceKm?: number }> | undefined): string | undefined {
  if (!list?.length) return undefined;
  const parts = list.slice(0, 3).map((p) => {
    if (p.driveMinutes) return `${p.name} (~${p.driveMinutes} min)`;
    if (p.distanceKm) return `${p.name} (${p.distanceKm} km)`;
    return p.name;
  });
  return `*${label}:* ${parts.join(' · ')}`;
}

function screen(name: string, lines: Array<string | undefined>): string | undefined {
  const body = lines.filter(Boolean);
  if (!body.length) return undefined;
  return [`*${name}*`, ...body].join('\n');
}

/** Trust & legal — only what the record holds; never volunteers a gap. */
function trustScreen(d: ProjectDetail): string | undefined {
  const phaseRera = (d.phases ?? [])
    .filter((p) => p.reraNumber && p.reraNumber !== d.reraNumber)
    .slice(0, 4)
    .map((p) => `*${p.phaseLabel} RERA:* ${p.reraNumber}`);
  return screen(`${d.name} — trust & legal`, [
    line('RERA', d.reraNumber),
    ...phaseRera,
    line('Khata', d.khata),
    line('EC', d.ecStatus),
    line('NA status', d.naStatus),
    line('Loan eligibility', d.loanEligibility),
  ]);
}

function placeScreen(d: ProjectDetail): string | undefined {
  const loc = d.location;
  return screen(`${d.name} — location`, [
    d.microMarket?.trim() ? `*Where:* ${d.microMarket.trim()}` : undefined,
    loc?.connectivitySummary?.trim(),
    pois('Schools', loc?.schools),
    pois('Hospitals', loc?.hospitals),
    pois('Metro', loc?.metroStations),
    pois('IT parks', loc?.itParks),
    loc?.driveTimes?.length ? `*Drive times:* ${loc.driveTimes.slice(0, 3).join(' · ')}` : undefined,
  ]);
}

function lifeScreen(d: ProjectDetail): string | undefined {
  if (!d.amenities?.length) return undefined;
  const list = d.amenities.slice(0, 10).join(' · ');
  const more = d.amenities.length > 10 ? ` — and ${d.amenities.length - 10} more` : '';
  return `*${d.name} — amenities*\n${list}${more}`;
}

function timeScreen(d: ProjectDetail): string | undefined {
  const phaseLines = (d.phases ?? [])
    .filter((p) => p.possession)
    .slice(0, 5)
    .map((p) => `*${p.phaseLabel}:* ${p.possession}${p.stage ? ` (${p.stage})` : ''}`);
  return screen(`${d.name} — possession`, [
    line('Possession', d.possession),
    ...phaseLines,
    d.phaseNote?.trim(),
  ]);
}

function laterScreen(d: ProjectDetail): string | undefined {
  const inv = d.investment as Record<string, unknown> | undefined;
  const intel = d.marketIntel as Record<string, unknown> | undefined;
  const pick = (o: Record<string, unknown> | undefined, keys: string[]): string[] =>
    o
      ? keys
          .filter((k) => typeof o[k] === 'string' && (o[k] as string).trim())
          .map((k) => (o[k] as string).trim())
      : [];
  const bits = [
    ...pick(intel, ['rentalYield', 'yield', 'appreciation', 'appreciationSummary', 'drivers']),
    ...pick(inv, ['rentalYield', 'expectedYield', 'operator', 'model', 'summary']),
  ];
  if (!bits.length) return undefined;
  return `*${d.name} — returns*\n${bits.slice(0, 4).join('\n')}`;
}

/**
 * The mock's project card — one screen that says what the project IS, one
 * labelled line per node the record can back, ending on the console question.
 * Lines the record cannot fill are absent, never apologised for.
 */
export function waConsoleCardReply(
  detail: ProjectDetail,
  units?: ReadonlyArray<{ unitType: string; priceDisplay: string; sizeDisplay?: string }>,
): string | undefined {
  const configs = detail.configurations ?? [];
  const sizes = [...new Set(configs.map((c) => /\d+\s*BHK|Studio|Villa|Plot/i.exec(c.unitType)?.[0]?.trim()).filter(Boolean))];
  const unitCount = units?.length ?? configs.length;
  const sqft = configs
    .map((c) => c.sizeDisplay)
    .filter(Boolean)
    .flatMap((s) => (s!.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, ''))))
    .filter((n) => n > 100);
  const sqftSpan = sqft.length ? `${Math.min(...sqft).toLocaleString('en-IN')}–${Math.max(...sqft).toLocaleString('en-IN')} sqft` : undefined;
  const trustBits = [
    detail.reraNumber ? 'RERA registered' : undefined,
    detail.khata,
  ].filter(Boolean);
  const placeBits = [
    detail.microMarket?.trim() || undefined,
    detail.location?.connectivitySummary?.trim() || detail.location?.driveTimes?.[0],
  ].filter(Boolean);
  const lifeBits = detail.summary?.trim()
    ? [detail.summary.trim().split(/(?<=\.)\s/)[0]!]
    : detail.amenities?.length
      ? [detail.amenities.slice(0, 3).join(' · ')]
      : [];
  const lines = [
    sizes.length ? `*Fit* — ${sizes.length} size${sizes.length > 1 ? 's' : ''}: ${sizes.slice(0, 4).join(' · ')}${sizes.length > 4 ? ' …' : ''}` : undefined,
    unitCount ? `*Unit* — ${unitCount} option${unitCount > 1 ? 's' : ''}${sqftSpan ? `, ${sqftSpan}` : ''}` : undefined,
    detail.startingPriceDisplay?.trim() ? `*Money* — from ${detail.startingPriceDisplay.trim()}` : undefined,
    trustBits.length ? `*Trust* — ${trustBits.join(' · ')}` : undefined,
    placeBits.length ? `*Place* — ${placeBits.join(' · ')}` : undefined,
    lifeBits.length ? `*Life* — ${lifeBits[0]}` : undefined,
    detail.possession?.trim() ? `*Time* — ${detail.possession.trim()}` : undefined,
  ].filter(Boolean);
  // A card with fewer than two backed lines is not a card.
  if (lines.length < 2) return undefined;
  return `*${detail.name}*\n\n${lines.join('\n')}\n\nWhat do you want to check?`;
}

/**
 * The authored screen for a node tap, cut from the SAME record the menu gate
 * read. Returns undefined when this turn is not a node tap or the record
 * cannot honestly fill the screen — the caller keeps the engine's reply then.
 */
export function waConsoleNodeReply(
  actionId: string | undefined,
  goal: TurnGoal,
  detail: ProjectDetail | undefined,
): string | undefined {
  if (!actionId || !detail) return undefined;
  const { aid, projectId } = splitProjectStamp(actionId.trim());
  if (!NODE_IDS.has(aid)) return undefined;
  // A stamped tap for another project must not speak this record.
  if (projectId && projectId !== detail.projectId) return undefined;
  if (goal.kind !== 'answer' && goal.kind !== 'commit') return undefined;

  switch (aid) {
    case WA_NODE_TRUST:
      return trustScreen(detail);
    case WA_NODE_PLACE:
      return placeScreen(detail);
    case WA_NODE_LIFE:
      return lifeScreen(detail);
    case WA_NODE_TIME:
      return timeScreen(detail);
    case WA_NODE_LATER:
      return laterScreen(detail);
    case WA_MENU_NODE:
      // "More about this project" opens the mock's card, not a bare prompt.
      return waConsoleCardReply(detail) ?? `*${detail.name}* — what would you like to check?`;
    default:
      return undefined;
  }
}
