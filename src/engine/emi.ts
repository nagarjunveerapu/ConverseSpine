/** EMI — derived from disclosure-filtered price + stated rate/tenure (no NayaDesk EMI endpoint). */

export interface EmiFacts {
  emiFormatted: string;
  principalFormatted: string;
  downPaymentFormatted?: string;
  basisFormatted: string;
  ratePercent: number;
  tenureYears: number;
}

export const DEFAULT_LTV = 0.8;
export const DEFAULT_RATE_PERCENT = 8.5;
export const DEFAULT_TENURE_YEARS = 20;

export function computeEmi(
  priceInr: number,
  ratePercent: number = DEFAULT_RATE_PERCENT,
  tenureYears: number = DEFAULT_TENURE_YEARS,
): EmiFacts | null {
  if (!isFinite(priceInr) || priceInr <= 0) return null;
  const rate = isFinite(ratePercent) && ratePercent > 0 ? ratePercent : DEFAULT_RATE_PERCENT;
  const years = isFinite(tenureYears) && tenureYears > 0 ? tenureYears : DEFAULT_TENURE_YEARS;

  const principal = Math.round(priceInr * DEFAULT_LTV);
  const down = priceInr - principal;
  const r = rate / 100 / 12;
  const n = years * 12;
  const emi = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

  return {
    emiFormatted: `₹${Math.round(emi).toLocaleString('en-IN')}`,
    principalFormatted: `₹${principal.toLocaleString('en-IN')}`,
    ...(down > 0 ? { downPaymentFormatted: `₹${down.toLocaleString('en-IN')}` } : {}),
    basisFormatted: `₹${priceInr.toLocaleString('en-IN')}`,
    ratePercent: rate,
    tenureYears: years,
  };
}
