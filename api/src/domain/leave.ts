/**
 * Leave entitlements and request validation.
 *
 * Statutory minimums come from the Manpower Law as amended and the Mother and Child
 * Welfare Law; anything beyond them (pro-rating the first eligible year, carry-over) is
 * labelled as company policy. See docs/leave-policy.md.
 */
import { addDays, countCalendarDays, countWorkingDays, type WorkCalendar } from "../engine/calendar.js";

export type LeaveUnit = "working_days" | "calendar_days";

export interface LeaveType {
  code: string;
  name: string;
  unit: LeaveUnit;
  paid: boolean;
  deductsAnnual: boolean;
  maxDays?: number;
  gender?: "F" | "M";
  needsReference?: string;
  backdateDays?: number;
  basis: string;
}

export const LEAVE_TYPES: LeaveType[] = [
  {
    code: "annual",
    name: "Annual leave",
    unit: "working_days",
    paid: true,
    deductsAnnual: true,
    basis: "UU 13/2003 Pasal 79 as amended by UU 6/2023: at least 12 working days after 12 months' continuous service",
  },
  {
    code: "marriage",
    name: "Own marriage",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 3,
    basis: "UU 13/2003 Pasal 93(4)(a)",
  },
  {
    code: "child_marriage",
    name: "Marriage of a child",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 2,
    basis: "UU 13/2003 Pasal 93(4)(b)",
  },
  {
    code: "child_ceremony",
    name: "Child's circumcision or baptism",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 2,
    basis: "UU 13/2003 Pasal 93(4)(c) and (d)",
  },
  {
    code: "paternity",
    name: "Accompanying a wife giving birth or miscarrying",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 5,
    gender: "M",
    basis: "UU 4/2024 (KIA) Pasal 6(2): 2 days, plus up to 3 more by agreement; UU 13/2003 Pasal 93(4)(e)",
  },
  {
    code: "bereavement_family",
    name: "Death of a spouse, parent, parent-in-law, child or child-in-law",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 2,
    backdateDays: 7,
    basis: "UU 13/2003 Pasal 93(4)(f)",
  },
  {
    code: "bereavement_household",
    name: "Death of a household member",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 1,
    backdateDays: 7,
    basis: "UU 13/2003 Pasal 93(4)(g)",
  },
  {
    code: "maternity",
    name: "Maternity leave",
    unit: "calendar_days",
    paid: true,
    deductsAnnual: false,
    maxDays: 90,
    gender: "F",
    basis: "UU 13/2003 Pasal 82; UU 4/2024 (KIA): at least the first three months",
  },
  {
    code: "sick",
    name: "Sick leave",
    unit: "working_days",
    paid: true,
    deductsAnnual: false,
    needsReference: "Doctor's note number",
    backdateDays: 14,
    basis: "UU 13/2003 Pasal 93(2)(a)",
  },
  {
    code: "unpaid",
    name: "Unpaid leave",
    unit: "working_days",
    paid: false,
    deductsAnnual: false,
    maxDays: 30,
    basis: "Company policy; always needs the department head",
  },
];

export const LEAVE_TYPE = new Map(LEAVE_TYPES.map((t) => [t.code, t]));
export const ANNUAL_DAYS = 12;

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * Annual-leave days for a calendar year. Eligible after 12 months of continuous service;
 * in the year eligibility starts, days are pro-rated by the whole months left after the
 * anniversary month (company policy).
 */
export function annualEntitlement(hireDate: string, year: number): { days: number; eligibleFrom: string } {
  const eligibleFrom = addMonths(hireDate, 12);
  if (eligibleFrom > `${year}-12-31`) return { days: 0, eligibleFrom };
  if (eligibleFrom <= `${year}-01-01`) return { days: ANNUAL_DAYS, eligibleFrom };
  const month = Number(eligibleFrom.slice(5, 7));
  return { days: Math.floor((ANNUAL_DAYS * (12 - month)) / 12), eligibleFrom };
}

export interface LeaveRequestInput {
  type: string;
  start: string;
  end: string;
  reference?: string | null;
}

export interface LeaveContext {
  today: string;
  gender: "F" | "M";
  hireDate: string;
  annualRemaining: number; // entitled + carried over - used - pending
  existing: { start: string; end: string }[]; // approved or pending, not cancelled
  calendar: WorkCalendar;
}

export interface LeaveCheck {
  days: number;
  unit: LeaveUnit;
  errors: string[];
  warnings: string[];
  balanceAfter: number | null;
  type?: LeaveType;
}

export function checkLeave(req: LeaveRequestInput, ctx: LeaveContext): LeaveCheck {
  const type = LEAVE_TYPE.get(req.type);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!type) return { days: 0, unit: "working_days", errors: ["Unknown leave type"], warnings, balanceAfter: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.start) || !/^\d{4}-\d{2}-\d{2}$/.test(req.end)) {
    return { days: 0, unit: type.unit, errors: ["Dates must be YYYY-MM-DD"], warnings, balanceAfter: null, type };
  }
  if (req.end < req.start) errors.push("The end date is before the start date");

  const earliest = addDays(ctx.today, -(type.backdateDays ?? 0));
  if (req.start < earliest) {
    errors.push(
      type.backdateDays
        ? `${type.name} can be backdated by at most ${type.backdateDays} days`
        : `${type.name} cannot start in the past`,
    );
  }

  const days =
    type.unit === "calendar_days" ? countCalendarDays(req.start, req.end) : countWorkingDays(req.start, req.end, ctx.calendar);
  if (req.end >= req.start && days === 0) errors.push("There are no working days in that range");
  if (type.maxDays !== undefined && days > type.maxDays) {
    errors.push(`${type.name} is at most ${type.maxDays} ${type.unit === "calendar_days" ? "calendar" : "working"} days`);
  }
  if (type.gender && type.gender !== ctx.gender) errors.push(`${type.name} does not apply to this employee`);
  if (type.needsReference && !req.reference?.trim()) errors.push(`${type.needsReference} is required`);
  if (type.code === "paternity" && days > 2) {
    warnings.push("Beyond 2 days, paternity leave is by agreement with the manager (UU KIA Pasal 6(2))");
  }

  for (const e of ctx.existing) {
    if (req.start <= e.end && e.start <= req.end) {
      errors.push(`Overlaps another request (${e.start} to ${e.end})`);
      break;
    }
  }

  let balanceAfter: number | null = null;
  if (type.deductsAnnual) {
    const { eligibleFrom } = annualEntitlement(ctx.hireDate, Number(req.start.slice(0, 4)));
    if (req.start < eligibleFrom) {
      errors.push(`Annual leave starts after 12 months' service (from ${eligibleFrom})`);
    }
    balanceAfter = ctx.annualRemaining - days;
    if (balanceAfter < 0) errors.push(`Only ${ctx.annualRemaining} annual leave days remain`);
  }
  return { days, unit: type.unit, errors, warnings, balanceAfter, type };
}
