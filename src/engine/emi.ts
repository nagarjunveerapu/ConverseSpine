/** EMI — derived from an authorized principal/basis (no NayaDesk EMI endpoint). */
import { fail, ok, type Outcome } from './outcome.js';

export interface EmiFacts {
  emiFormatted: string;
  principalFormatted: string;
  downPaymentFormatted?: string;
  basisFormatted: string;
  basisKind: 'explicit_principal' | 'project_price';
  ltvPercent?: number;
  ratePercent: number;
  tenureYears: number;
}

export const DEFAULT_LTV = 0.8;
export const DEFAULT_RATE_PERCENT = 8.5;
export const DEFAULT_TENURE_YEARS = 20;

export interface EmiInput {
  /** Buyer-stated loan principal. Wins over a project price when present. */
  principalInr?: number;
  /** Disclosure-filtered focused/shortlisted project price. */
  projectPriceInr?: number;
  ratePercent?: number;
  tenureYears?: number;
}

export function computeEmi(input: EmiInput): Outcome<EmiFacts> {
  const explicit =
    input.principalInr !== undefined &&
    isFinite(input.principalInr) &&
    input.principalInr > 0
      ? input.principalInr
      : undefined;
  const projectPrice =
    input.projectPriceInr !== undefined &&
    isFinite(input.projectPriceInr) &&
    input.projectPriceInr > 0
      ? input.projectPriceInr
      : undefined;
  if (explicit === undefined && projectPrice === undefined) {
    return fail({
      kind: 'missing_input',
      stage: 'tool',
      subject: 'emi.principal',
    });
  }

  const ratePercent = input.ratePercent ?? DEFAULT_RATE_PERCENT;
  const tenureYears = input.tenureYears ?? DEFAULT_TENURE_YEARS;
  const rate = isFinite(ratePercent) && ratePercent > 0 ? ratePercent : DEFAULT_RATE_PERCENT;
  const years = isFinite(tenureYears) && tenureYears > 0 ? tenureYears : DEFAULT_TENURE_YEARS;

  const basisKind = explicit !== undefined ? 'explicit_principal' : 'project_price';
  const basis = explicit ?? projectPrice!;
  const principal = Math.round(explicit ?? projectPrice! * DEFAULT_LTV);
  const down = basisKind === 'project_price' ? projectPrice! - principal : 0;
  const r = rate / 100 / 12;
  const n = years * 12;
  const emi = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

  return ok({
    emiFormatted: `₹${Math.round(emi).toLocaleString('en-IN')}`,
    principalFormatted: `₹${principal.toLocaleString('en-IN')}`,
    ...(down > 0 ? { downPaymentFormatted: `₹${down.toLocaleString('en-IN')}` } : {}),
    basisFormatted: `₹${basis.toLocaleString('en-IN')}`,
    basisKind,
    ...(basisKind === 'project_price' ? { ltvPercent: DEFAULT_LTV * 100 } : {}),
    ratePercent: rate,
    tenureYears: years,
  });
}
