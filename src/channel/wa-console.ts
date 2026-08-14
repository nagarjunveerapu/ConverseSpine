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
import { humanizeMediaKind } from '../engine/media-asset.js';
import type { ProjectDetail, TurnGoal } from '../engine/types.js';
import {
  splitProjectStamp,
  WA_BACK_FILE,
  WA_MENU_NODE,
  WA_NODE_LATER,
  WA_NODE_LIFE,
  WA_NODE_MEDIA,
  WA_NODE_MONEY,
  WA_NODE_PLACE,
  WA_NODE_TIME,
  WA_NODE_TRUST,
  WA_NODE_UNIT,
  WA_SUB_PREFIX,
} from './wa-pack.js';

const NODE_IDS = new Set([
  WA_NODE_TRUST,
  WA_NODE_PLACE,
  WA_NODE_LIFE,
  WA_NODE_TIME,
  WA_NODE_LATER,
  WA_NODE_MONEY,
  WA_NODE_UNIT,
  WA_NODE_MEDIA,
  WA_MENU_NODE,
  WA_BACK_FILE,
]);

export function isWaNodeTap(actionId: string | undefined): boolean {
  if (!actionId) return false;
  const { aid } = splitProjectStamp(actionId.trim());
  return NODE_IDS.has(aid) || aid.startsWith(WA_SUB_PREFIX);
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
    // Loan eligibility is money, and Money now has a "Banks & loan" row that
    // reads this same field. One fact, one place.
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
  if (d.amenities?.length) {
    const list = d.amenities.slice(0, 10).join(' · ');
    const more = d.amenities.length > 10 ? ` — and ${d.amenities.length - 10} more` : '';
    return `*${d.name} — amenities*\n${list}${more}`;
  }
  // Most catalog rows carry the township's NUMBERS but not an amenity list —
  // 80,000 sqft of amenities on 50 acres is a real answer, and refusing it
  // because a different column is empty is the gap talking, not the record.
  return specScreen(d);
}

/**
 * What the project can put on your phone, counted honestly. A buyer asking for
 * "the brochure" should never have to guess whether one exists — the shelf says
 * what is on it, and every row below it sends the file it names.
 */
function mediaScreen(d: ProjectDetail): string | undefined {
  const assets = d.mediaAssets ?? [];
  if (!assets.length) return undefined;
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const bits = [...counts.entries()].map(
    ([kind, n]) => `${humanizeMediaKind(kind)}${n > 1 ? ` (${n})` : ''}`,
  );
  return `*${d.name} — what I can send you*\n${bits.join(' · ')}`;
}

function specScreen(d: ProjectDetail): string | undefined {
  const s = d.spec;
  if (!s) return undefined;
  const n = (v: number) => v.toLocaleString('en-IN');
  return screen(`${d.name} — the township`, [
    s.totalAcres ? `*Land:* ${n(s.totalAcres)} acres` : undefined,
    s.towerCount
      ? `*Towers:* ${s.towerCount}${s.floorsPerTower ? ` · ${s.floorsPerTower} floors each` : ''}`
      : undefined,
    s.totalUnits ? `*Homes:* ${n(s.totalUnits)}` : undefined,
    s.openSpacePct ? `*Open space:* ${s.openSpacePct}%` : undefined,
    s.amenitiesSqft ? `*Amenities:* ${n(s.amenitiesSqft)} sqft` : undefined,
    line('Water', s.waterSupply),
    line('Power backup', s.powerBackup),
  ]);
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

function rentInr(v: number): string {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1).replace(/\.0$/, '')} L`;
  return `₹${Math.round(v / 1_000)}k`;
}

/**
 * Returns — reads EXACTLY the fields hasReturnsData gates on (wa-pack.ts), so
 * a drawn Returns row can never open onto an empty screen. The old version
 * duck-typed keys (`rentalYield`, `appreciationSummary`…) that the real
 * ProjectMarketIntel/ProjectInvestment shapes never carried.
 */
function laterScreen(d: ProjectDetail): string | undefined {
  const intel = d.marketIntel;
  const inv = d.investment;
  const lines: Array<string | undefined> = [];
  if (intel?.appreciation3yrPct !== undefined) {
    lines.push(`*Appreciation:* +${intel.appreciation3yrPct}% over 3 yrs${intel.appreciation5yrPct !== undefined ? ` · +${intel.appreciation5yrPct}% over 5 yrs` : ''}`);
  } else if (intel?.appreciation5yrPct !== undefined) {
    lines.push(`*Appreciation:* +${intel.appreciation5yrPct}% over 5 yrs`);
  }
  if (intel?.corridorMaturity?.trim()) lines.push(`*Corridor:* ${intel.corridorMaturity.trim()}`);
  for (const band of (intel?.rentBands ?? []).slice(0, 2)) {
    const range = [band.rentMinInr, band.rentMaxInr]
      .filter((v): v is number => typeof v === 'number' && v > 0)
      .map(rentInr);
    if (range.length) {
      lines.push(`*Rent${band.unitType ? ` (${band.unitType})` : ''}:* ${range.join('–')}/month`);
    }
  }
  for (const drv of (intel?.drivers ?? []).slice(0, 2)) {
    if (drv.event?.trim()) lines.push(`• ${drv.event.trim()}${drv.date ? ` (${drv.date})` : ''}`);
  }
  if (inv?.expectedRoi?.trim()) lines.push(`*Expected ROI:* ${inv.expectedRoi.trim()}`);
  if (inv?.revenueModel?.trim()) lines.push(`*Model:* ${inv.revenueModel.trim()}`);
  if (inv?.operatorBrand?.trim()) lines.push(`*Operator:* ${inv.operatorBrand.trim()}`);
  if (inv?.guaranteedPayment?.trim()) lines.push(`*Guaranteed:* ${inv.guaranteedPayment.trim()}`);
  const body = lines.filter(Boolean).slice(0, 5);
  if (!body.length) return undefined;
  const tag = intel?.provenanceLabel?.trim() ? `\n_${intel.provenanceLabel.trim()}_` : '';
  return `*${d.name} — returns*\n${body.join('\n')}${tag}`;
}

/**
 * One sub-topic, answered on its own. The screen reads EXACTLY the field the
 * sub-row's gate read — the row for a khata says the khata, so a drawn row can
 * never open onto "I don't have that". A topic the record cannot fill returns
 * nothing and the engine's own reply stands.
 */
function subScreen(topic: string, d: ProjectDetail): string | undefined {
  const loc = d.location;
  switch (topic) {
    case 'trust.rera': {
      const phaseRera = (d.phases ?? [])
        .filter((p) => p.reraNumber && p.reraNumber !== d.reraNumber)
        .slice(0, 5)
        .map((p) => `*${p.phaseLabel}:* ${p.reraNumber}`);
      return screen(`${d.name} — RERA`, [
        line('RERA', d.reraNumber),
        ...phaseRera,
        line('Registration', d.registrationScope),
        line('Applicability', d.reraApplicability),
      ]);
    }
    case 'trust.khata':
      return screen(`${d.name} — khata & title`, [
        line('Khata', d.khata),
        line('Land', d.investment?.landClassification),
      ]);
    case 'trust.ec':
      return screen(`${d.name} — encumbrance`, [line('EC', d.ecStatus)]);
    case 'trust.approvals':
      return screen(`${d.name} — approvals & land use`, [
        line('Approving authority', d.approvalAuthority),
        line('Land classification', d.investment?.landClassification),
        line('NA status', d.naStatus),
      ]);
    case 'place.metro':
      return screen(`${d.name} — commute`, [
        pois('Metro', loc?.metroStations),
        loc?.driveTimes?.length ? `*Drive times:* ${loc.driveTimes.slice(0, 4).join(' · ')}` : undefined,
        loc?.connectivitySummary?.trim(),
      ]);
    case 'place.schools':
      return screen(`${d.name} — schools`, [pois('Schools', loc?.schools)]);
    case 'place.hospitals':
      return screen(`${d.name} — hospitals`, [pois('Hospitals', loc?.hospitals)]);
    case 'place.commute':
      return screen(`${d.name} — commute`, [
        loc?.driveTimes?.length ? `*Drive times:* ${loc.driveTimes.slice(0, 4).join(' · ')}` : undefined,
        loc?.connectivitySummary?.trim(),
      ]);
    case 'life.amenities':
      return lifeScreen(d);
    case 'life.spec': {
      const s = d.spec;
      if (!s) return undefined;
      const n = (v: number) => v.toLocaleString('en-IN');
      return screen(`${d.name} — size & layout`, [
        s.totalAcres ? `*Land:* ${n(s.totalAcres)} acres` : undefined,
        s.towerCount
          ? `*Towers:* ${s.towerCount}${s.floorsPerTower ? ` · ${s.floorsPerTower} floors each` : ''}`
          : undefined,
        s.totalUnits ? `*Homes:* ${n(s.totalUnits)}` : undefined,
        s.openSpacePct ? `*Open space:* ${s.openSpacePct}%` : undefined,
        s.amenitiesSqft ? `*Amenities:* ${n(s.amenitiesSqft)} sqft` : undefined,
        line('Water', s.waterSupply),
        line('Power backup', s.powerBackup),
      ]);
    }
    case 'time.possession':
      return screen(`${d.name} — possession`, [line('Possession', d.possession), d.phaseNote?.trim()]);
    case 'time.phases':
      return timeScreen(d);
    case 'money.loan':
      return screen(`${d.name} — banks & loan`, [line('Loan eligibility', d.loanEligibility)]);
    default:
      return undefined;
  }
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

  if (aid.startsWith(WA_SUB_PREFIX)) return subScreen(aid.slice(WA_SUB_PREFIX.length), detail);

  switch (aid) {
    case WA_BACK_FILE:
      return waConsoleCardReply(detail) ?? `*${detail.name}* — what would you like to check?`;
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
    case WA_NODE_MEDIA:
      return mediaScreen(detail);
    case WA_MENU_NODE:
      // "More about this project" opens the mock's card, not a bare prompt.
      return waConsoleCardReply(detail) ?? `*${detail.name}* — what would you like to check?`;
    default:
      return undefined;
  }
}
