/** The inbox, task detail and task completion. */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { hasRole, requireUser, type AppEnv, type SessionUser } from "../auth.js";
import { db } from "../db/client.js";
import { employees, notifications, tasks, workflowInstances } from "../db/schema.js";
import { completeTask } from "../services/runtime.js";

export const work = new Hono<AppEnv>();
work.use("*", requireUser);

function mine(user: SessionUser) {
  const roleQueues = user.roles.filter((r) => ["HR_OPS", "IT_SUPPORT", "GENERAL_AFFAIRS", "PAYROLL"].includes(r));
  return roleQueues.length
    ? or(eq(tasks.assigneeEmployeeId, user.employeeId), inArray(tasks.assigneeRole, roleQueues))
    : eq(tasks.assigneeEmployeeId, user.employeeId);
}

/** The context fields worth showing on a task card, per workflow. */
export function summarise(key: string, c: Record<string, unknown>) {
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter((k) => c[k] !== undefined && c[k] !== null).map((k) => [k, c[k]]));
  switch (key) {
    case "leave_request":
      return pick("leave_label", "start_date", "end_date", "days", "unit", "paid", "balance_before", "balance_after", "reference", "reason", "warnings", "basis");
    case "contract_renewal":
      return pick("contract_start", "contract_end", "renewal_end", "pkwt_months_used", "pkwt_months_remaining", "allowed_decisions", "monthly_wage", "compensation_months", "compensation_amount", "decision");
    case "onboarding":
      return pick("hire_date", "position", "location", "employment_type", "probation_end");
    case "offboarding":
      return pick("last_day", "submitted_on", "notice_days", "notice_short", "reason", "employment_type");
    default:
      return {};
  }
}

const taskColumns = {
  id: tasks.id,
  instanceId: tasks.instanceId,
  name: tasks.name,
  kind: tasks.kind,
  stepId: tasks.stepId,
  branchId: tasks.branchId,
  assigneeEmployeeId: tasks.assigneeEmployeeId,
  assigneeRole: tasks.assigneeRole,
  createdAt: tasks.createdAt,
  dueAt: tasks.dueAt,
  originalDueAt: tasks.originalDueAt,
  escalationLevel: tasks.escalationLevel,
  checklist: tasks.checklist,
  options: tasks.options,
  instructions: tasks.instructions,
  status: tasks.status,
  key: workflowInstances.key,
  title: workflowInstances.title,
  state: workflowInstances.state,
  subjectId: workflowInstances.subjectEmployeeId,
  subjectName: employees.fullName,
  subjectNo: employees.employeeNo,
  subjectPosition: employees.position,
  subjectLocation: employees.location,
};

function shape(row: { state: unknown; key: string } & Record<string, unknown>, user: SessionUser) {
  const { state, ...rest } = row;
  const context = (state as { context: Record<string, unknown> }).context;
  return {
    ...rest,
    queue: row.assigneeEmployeeId === user.employeeId ? "me" : row.assigneeRole,
    overdue: new Date(String(row.dueAt)) < new Date(),
    summary: summarise(row.key, context),
  };
}

work.get("/inbox", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select(taskColumns)
    .from(tasks)
    .innerJoin(workflowInstances, eq(workflowInstances.id, tasks.instanceId))
    .innerJoin(employees, eq(employees.id, workflowInstances.subjectEmployeeId))
    .where(and(eq(tasks.status, "open"), mine(user)))
    .orderBy(tasks.dueAt);
  const done = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.completedBy, user.employeeId), sql`${tasks.completedAt} > now() - interval '7 days'`));
  return c.json({ tasks: rows.map((r) => shape(r, user)), completedThisWeek: done[0]?.n ?? 0 });
});

work.get("/tasks/:id", async (c) => {
  const user = c.get("user");
  const [row] = await db
    .select(taskColumns)
    .from(tasks)
    .innerJoin(workflowInstances, eq(workflowInstances.id, tasks.instanceId))
    .innerJoin(employees, eq(employees.id, workflowInstances.subjectEmployeeId))
    .where(eq(tasks.id, Number(c.req.param("id"))));
  if (!row) throw new HTTPException(404, { message: "Task not found" });
  const allowed =
    row.assigneeEmployeeId === user.employeeId || (row.assigneeRole && user.roles.includes(row.assigneeRole)) || hasRole(user, "ADMIN", "HR_OPS");
  if (!allowed) throw new HTTPException(404, { message: "Task not found" });
  return c.json(shape(row, user));
});

const Complete = z.object({ outcome: z.string().min(1), note: z.string().max(500).optional() });

work.post("/tasks/:id/complete", async (c) => {
  const user = c.get("user");
  const body = Complete.parse(await c.req.json());
  const [task] = await db.select().from(tasks).where(eq(tasks.id, Number(c.req.param("id"))));
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  const allowed = task.assigneeEmployeeId === user.employeeId || (task.assigneeRole !== null && user.roles.includes(task.assigneeRole));
  if (!allowed) throw new HTTPException(403, { message: "This task is assigned to someone else" });
  if (task.kind === "approval" && body.outcome === "rejected" && !body.note?.trim()) {
    throw new HTTPException(422, { message: "Say why when you reject, so the requester knows what to change" });
  }
  const instanceId = await completeTask({ taskId: task.id, actorEmployeeId: user.employeeId, outcome: body.outcome, note: body.note, actor: user.email });
  return c.json({ instanceId });
});

work.get("/notifications", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.employeeId, user.employeeId))
    .orderBy(desc(notifications.at))
    .limit(30);
  return c.json(rows);
});

work.post("/notifications/read", async (c) => {
  const user = c.get("user");
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.employeeId, user.employeeId), sql`${notifications.readAt} IS NULL`));
  return c.body(null, 204);
});
