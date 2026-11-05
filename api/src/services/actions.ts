/**
 * Named actions that workflow steps can trigger. Each runs inside the transaction that
 * advanced the instance, so a failure rolls the whole step back.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Tx } from "../db/client.js";
import { contracts, employees, leaveBalances } from "../db/schema.js";
import { annualEntitlement, LEAVE_TYPE } from "../domain/leave.js";

export interface ActionInput {
  subjectId: number;
  context: Record<string, unknown>;
  today: string;
}

type Action = (tx: Tx, input: ActionInput) => Promise<void>;

const applyLeave: Action = async (tx, { subjectId, context }) => {
  const type = LEAVE_TYPE.get(String(context.leave_type));
  if (!type?.deductsAnnual) return;
  const year = Number(String(context.start_date).slice(0, 4));
  const days = Number(context.days);
  const updated = await tx
    .update(leaveBalances)
    .set({ used: sql`${leaveBalances.used} + ${days}` })
    .where(and(eq(leaveBalances.employeeId, subjectId), eq(leaveBalances.year, year)))
    .returning();
  if (updated.length === 0) {
    const [emp] = await tx.select().from(employees).where(eq(employees.id, subjectId));
    await tx.insert(leaveBalances).values({
      employeeId: subjectId,
      year,
      entitled: emp ? annualEntitlement(emp.hireDate, year).days : 0,
      used: days,
    });
  }
};

const recordContract: Action = async (tx, { subjectId, context }) => {
  const decision = context.decision;
  const start = String(context.next_start);
  if (decision === "renew") {
    await tx.insert(contracts).values({ employeeId: subjectId, kind: "PKWT", startDate: start, endDate: String(context.renewal_end) });
  } else if (decision === "convert") {
    await tx.insert(contracts).values({ employeeId: subjectId, kind: "PKWTT", startDate: start, endDate: null });
    await tx.update(employees).set({ employmentType: "PKWTT" }).where(eq(employees.id, subjectId));
  }
};

const deactivateEmployee: Action = async (tx, { subjectId, context, today }) => {
  const lastDay = String(context.last_day);
  await tx
    .update(employees)
    .set({ lastDay, isActive: lastDay >= today })
    .where(eq(employees.id, subjectId));
};

export const ACTIONS: Record<string, Action> = {
  apply_leave: applyLeave,
  record_contract: recordContract,
  deactivate_employee: deactivateEmployee,
};
