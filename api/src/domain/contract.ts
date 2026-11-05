/**
 * PKWT arithmetic under PP 35/2021.
 *
 * - Pasal 8: a time-based PKWT, extensions included, may not exceed five years.
 * - Pasal 15–16: when a PKWT ends, an employee with at least one month of continuous
 *   service receives compensation of (months of service / 12) x one month's wage, where
 *   the wage is base pay plus fixed allowances.
 */

export interface PkwtPeriod {
  start: string;
  end: string;
}

const MAX_PKWT_MONTHS = 60;

/** Months between two dates, inclusive of the end day, with the partial month as a fraction. */
export function monthsOfService(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  e.setUTCDate(e.getUTCDate() + 1); // inclusive end
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  const anchor = new Date(s);
  anchor.setUTCMonth(s.getUTCMonth() + months);
  if (anchor > e) {
    months -= 1;
    anchor.setUTCMonth(s.getUTCMonth() + months);
  }
  const nextAnchor = new Date(s);
  nextAnchor.setUTCMonth(s.getUTCMonth() + months + 1);
  const fraction = (e.getTime() - anchor.getTime()) / (nextAnchor.getTime() - anchor.getTime());
  return Math.round((months + fraction) * 100) / 100;
}

export function compensation(period: PkwtPeriod, monthlyWage: number): { months: number; amount: number } {
  const months = monthsOfService(period.start, period.end);
  if (months < 1) return { months, amount: 0 };
  return { months, amount: Math.round((months / 12) * monthlyWage) };
}

export function renewalOptions(periods: PkwtPeriod[], extensionMonths = 12) {
  const used = periods.reduce((sum, p) => sum + monthsOfService(p.start, p.end), 0);
  const canRenew = used + extensionMonths <= MAX_PKWT_MONTHS + 1e-9;
  return {
    usedMonths: Math.round(used * 100) / 100,
    remainingMonths: Math.max(0, Math.round((MAX_PKWT_MONTHS - used) * 100) / 100),
    allowed: canRenew ? ["renew", "convert", "end"] : ["convert", "end"],
  };
}
