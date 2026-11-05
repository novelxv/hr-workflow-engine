/**
 * Starting workflows: everything the definitions route on is computed here, before the
 * engine sees it, so each definition stays a readable routing table.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { contracts, departments, employees, leaveBalances, workflowInstances } from "../db/schema.js";
import { addDays, wibDate } from "../engine/calendar.js";
import { compensation, renewalOptions } from "../domain/contract.js";
import { annualEntitlement, checkLeave, LEAVE_TYPE, type LeaveCheck } from "../domain/leave.js";
import { loadCalendar } from "./directory.js";
import { RuntimeError, startInstance } from "./runtime.js";

type Employee = typeof employees.$inferSelect;

async function employee(db: DbOrTx, id: number): Promise<Employee> {
  const [e] = await db.select().from(employees).where(eq(employees.id, id));
  if (!e) throw new RuntimeError("Employee not found", 404);
  return e;
}

// --- leave ------------------------------------------------------------------------------

export interface Balance {
  year: number;
  entitled: number;
  carriedOver: number;
  used: number;
  pending: number;
  remaining: number;
  eligibleFrom: string;
}

export async function leaveBalance(db: DbOrTx, employeeId: number, year: number): Promise<Balance> {
  const emp = await employee(db, employeeId);
  const [row] = await db
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.year, year)));
  const ent = annualEntitlement(emp.hireDate, year);
  const running = await db
    .select({ state: workflowInstances.state })
    .from(workflowInstances)
    .where(
      and(
        eq(workflowInstances.subjectEmployeeId, employeeId),
        eq(workflowInstances.key, "leave_request"),
        eq(workflowInstances.status, "running"),
      ),
    );
  const pending = running.reduce((sum, r) => {
    const c = (r.state as { context: Record<string, unknown> }).context;
    const deducts = LEAVE_TYPE.get(String(c.leave_type))?.deductsAnnual;
    return deducts && String(c.start_date).startsWith(String(year)) ? sum + Number(c.days) : sum;
  }, 0);
  const entitled = row?.entitled ?? ent.days;
  const carriedOver = row?.carriedOver ?? 0;
  const used = row?.used ?? 0;
  return {
    year,
    entitled,
    carriedOver,
    used,
    pending,
    remaining: entitled + carriedOver - used - pending,
    eligibleFrom: ent.eligibleFrom,
  };
}

async function existingLeave(db: DbOrTx, employeeId: number) {
  const rows = await db
    .select({ state: workflowInstances.state })
    .from(workflowInstances)
    .where(
      and(
        eq(workflowInstances.subjectEmployeeId, employeeId),
        eq(workflowInstances.key, "leave_request"),
        inArray(workflowInstances.status, ["running", "approved"]),
      ),
    );
  return rows.map((r) => {
    const c = (r.state as { context: Record<string, unknown> }).context;
    return { start: String(c.start_date), end: String(c.end_date) };
  });
}

export async function previewLeave(
  db: DbOrTx,
  employeeId: number,
  input: { type: string; start: string; end: string; reference?: string | null },
  now = new Date(),
): Promise<LeaveCheck & { balance: Balance | null }> {
  const emp = await employee(db, employeeId);
  const today = wibDate(now);
  const year = Number((input.start || today).slice(0, 4)) || Number(today.slice(0, 4));
  const balance = await leaveBalance(db, employeeId, year);
  const check = checkLeave(input, {
    today,
    gender: emp.gender as "F" | "M",
    hireDate: emp.hireDate,
    annualRemaining: balance.remaining,
    existing: await existingLeave(db, employeeId),
    calendar: await loadCalendar(db),
  });
  return { ...check, balance: check.type?.deductsAnnual ? balance : null };
}

export async function requestLeave(
  db: DbOrTx,
  args: { employeeId: number; initiatorId: number; actor: string; type: string; start: string; end: string; reason?: string; reference?: string | null },
  now = new Date(),
) {
  const check = await previewLeave(db, args.employeeId, args, now);
  if (check.errors.length) throw new RuntimeError(check.errors.join("; "), 422);
  const emp = await employee(db, args.employeeId);
  const [dept] = await db.select().from(departments).where(eq(departments.code, emp.departmentCode));
  const type = check.type!;
  return startInstance({
    key: "leave_request",
    subjectId: emp.id,
    initiatorId: args.initiatorId,
    actor: args.actor,
    now,
    title: `${type.name}: ${emp.fullName}, ${args.start} to ${args.end}`,
    context: {
      leave_type: type.code,
      leave_label: type.name,
      paid: type.paid,
      start_date: args.start,
      end_date: args.end,
      days: check.days,
      unit: check.unit,
      reason: args.reason ?? null,
      reference: args.reference ?? null,
      balance_before: check.balance?.remaining ?? null,
      balance_after: check.balanceAfter,
      warnings: check.warnings,
      basis: type.basis,
      manager_is_head: dept?.headEmployeeId !== null && dept?.headEmployeeId === emp.managerId,
    },
  });
}

// --- resignation and onboarding ---------------------------------------------------------

const NOTICE_DAYS = 30; // company policy

export async function requestResignation(
  db: DbOrTx,
  args: { employeeId: number; initiatorId: number; actor: string; lastDay: string; reason?: string },
  now = new Date(),
) {
  const emp = await employee(db, args.employeeId);
  const today = wibDate(now);
  if (args.lastDay < today) throw new RuntimeError("The last day cannot be in the past", 422);
  const open = await db
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.subjectEmployeeId, emp.id), eq(workflowInstances.key, "offboarding"), eq(workflowInstances.status, "running")));
  if (open.length) throw new RuntimeError("An offboarding is already running for this employee", 409);
  const noticeDays = Math.round((Date.parse(args.lastDay) - Date.parse(today)) / 86_400_000);
  return startInstance({
    key: "offboarding",
    subjectId: emp.id,
    initiatorId: args.initiatorId,
    actor: args.actor,
    now,
    title: `Offboarding: ${emp.fullName}, last day ${args.lastDay}`,
    context: {
      last_day: args.lastDay,
      submitted_on: today,
      notice_days: noticeDays,
      notice_short: noticeDays < NOTICE_DAYS,
      reason: args.reason ?? null,
      employment_type: emp.employmentType,
    },
  });
}

export async function startOnboarding(
  db: DbOrTx,
  args: { employeeId: number; initiatorId: number | null; actor: string },
  now = new Date(),
) {
  const emp = await employee(db, args.employeeId);
  const open = await db
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .where(and(eq(workflowInstances.subjectEmployeeId, emp.id), eq(workflowInstances.key, "onboarding")));
  if (open.length) throw new RuntimeError("Onboarding was already started for this employee", 409);
  const probationEnd = emp.probationMonths > 0 ? addMonthsIso(emp.hireDate, emp.probationMonths) : null;
  return startInstance({
    key: "onboarding",
    subjectId: emp.id,
    initiatorId: args.initiatorId,
    actor: args.actor,
    now,
    title: `Onboarding: ${emp.fullName}, starts ${emp.hireDate}`,
    context: {
      hire_date: emp.hireDate,
      employment_type: emp.employmentType,
      probation_months: emp.probationMonths,
      probation_end: probationEnd,
      probation_review_date: probationEnd ? addDays(probationEnd, -14) : null,
      position: emp.position,
      location: emp.location,
    },
  });
}

// --- contract renewal -------------------------------------------------------------------

export const RENEWAL_LEAD_DAYS = 45;

export async function startRenewal(db: DbOrTx, employeeId: number, now = new Date()) {
  const emp = await employee(db, employeeId);
  const history = await db
    .select()
    .from(contracts)
    .where(eq(contracts.employeeId, employeeId))
    .orderBy(desc(contracts.startDate));
  const current = history[0];
  if (!current || current.kind !== "PKWT" || !current.endDate) {
    throw new RuntimeError("No current PKWT to renew", 422);
  }
  const pkwt = history.filter((c) => c.kind === "PKWT" && c.endDate).map((c) => ({ start: c.startDate, end: c.endDate! }));
  const options = renewalOptions(pkwt);
  const comp = compensation({ start: current.startDate, end: current.endDate }, emp.monthlyWage);
  const nextStart = addDays(current.endDate, 1);
  return startInstance({
    key: "contract_renewal",
    subjectId: emp.id,
    initiatorId: null,
    actor: "system:contract-scan",
    now,
    title: `PKWT renewal: ${emp.fullName}, contract ends ${current.endDate}`,
    context: {
      contract_start: current.startDate,
      contract_end: current.endDate,
      next_start: nextStart,
      renewal_end: addDays(addMonthsIso(nextStart, 12), -1),
      pkwt_months_used: options.usedMonths,
      pkwt_months_remaining: options.remainingMonths,
      allowed_decisions: options.allowed,
      monthly_wage: emp.monthlyWage,
      compensation_months: comp.months,
      compensation_amount: comp.amount,
      decision: null,
    },
  });
}

/** PKWTs ending within the lead time that have no renewal yet. */
export async function contractsDueForRenewal(db: DbOrTx, now = new Date()): Promise<number[]> {
  const today = wibDate(now);
  const horizon = addDays(today, RENEWAL_LEAD_DAYS);
  const rows = await db.execute<{ employee_id: number }>(sql`
    SELECT c.employee_id
    FROM contracts c
    JOIN employees e ON e.id = c.employee_id AND e.is_active
    WHERE c.kind = 'PKWT' AND c.end_date BETWEEN ${today} AND ${horizon}
      AND NOT EXISTS (SELECT 1 FROM contracts later WHERE later.employee_id = c.employee_id AND later.start_date > c.start_date)
      AND NOT EXISTS (
        SELECT 1 FROM workflow_instances w
        WHERE w.subject_employee_id = c.employee_id AND w.key = 'contract_renewal'
          AND (w.state -> 'context' ->> 'contract_end') = c.end_date::text
      )
  `);
  return rows.map((r) => r.employee_id);
}

function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
