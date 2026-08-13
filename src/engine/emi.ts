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

export interface Affordability {
  monthlyInr: number;
  /** What that monthly instalment services over the standing rate and tenure. */
  loanInr: number;
  /** Loan plus the usual down payment — the home price it points at. */
  priceInr: number;
  ratePercent: number;
  tenureYears: number;
}

/**
 * The inverse of `computeEmi` — a buyer who says "I can pay 60000 a month" has
 * given a budget in the only unit they think in, and answering with a filter
 * prompt makes them do arithmetic we can do for them.
 *
 * Every number here is an estimate off standing defaults, never a sanction: the
 * reply that speaks it has to name the rate and the tenure it assumed.
 */
/**
 * The share of take-home pay a lender will let an instalment consume. Not our
 * rule and not advice — it is the number underwriting actually uses, and any
 * reply built on it has to say so out loud.
 */
export const INCOME_SERVICING_RATIO = 0.4;

export function affordabilityFromEmi(input: {
  monthlyInr: number;
  ratePercent?: number;
  tenureYears?: number;
}): Affordability | undefined {
  const monthly = input.monthlyInr;
  if (!isFinite(monthly) || monthly <= 0) return undefined;
  const ratePercent =
    input.ratePercent && isFinite(input.ratePercent) && input.ratePercent > 0
      ? input.ratePercent
      : DEFAULT_RATE_PERCENT;
  const tenureYears =
    input.tenureYears && isFinite(input.tenureYears) && input.tenureYears > 0
      ? input.tenureYears
      : DEFAULT_TENURE_YEARS;
  const r = ratePercent / 100 / 12;
  const n = tenureYears * 12;
  const growth = Math.pow(1 + r, n);
  const loan = (monthly * (growth - 1)) / (r * growth);
  if (!isFinite(loan) || loan <= 0) return undefined;
  // Round to the nearest lakh — a rupee-exact affordability number reads like a
  // sanction letter, and this is arithmetic on two assumptions.
  const round = (x: number) => Math.round(x / 100_000) * 100_000;
  return {
    monthlyInr: Math.round(monthly),
    loanInr: round(loan),
    priceInr: round(loan / DEFAULT_LTV),
    ratePercent,
    tenureYears,
  };
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
