/** Starting requests, and reading them back. */
import { aliasedTable, and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { hasRole, requireRole, requireUser, type AppEnv, type SessionUser } from "../auth.js";
import { db } from "../db/client.js";
import { employees, instanceEvents, tasks, workflowInstances } from "../db/schema.js";
import { wibDate } from "../engine/calendar.js";
import { LEAVE_TYPES } from "../domain/leave.js";
import { definitionById } from "../services/directory.js";
import { leaveBalance, previewLeave, requestLeave, requestResignation, startOnboarding } from "../services/requests.js";
import { cancelInstance } from "../services/runtime.js";
import { summarise } from "./work.js";

export const requests = new Hono<AppEnv>();
requests.use("*", requireUser);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function forWhom(user: SessionUser, employeeId?: number) {
  if (employeeId && employeeId !== user.employeeId) {
    if (!hasRole(user, "HR_OPS", "ADMIN")) throw new HTTPException(403, { message: "Only HR can file for someone else" });
    return employeeId;
  }
  return user.employeeId;
}

requests.get("/leave/types", (c) =>
  c.json(LEAVE_TYPES.map(({ code, name, unit, paid, maxDays, gender, needsReference, basis }) => ({ code, name, unit, paid, maxDays, gender, needsReference, basis }))),
);

requests.get("/leave/balance", async (c) => {
  const user = c.get("user");
  const employeeId = forWhom(user, Number(c.req.query("employee_id")) || undefined);
  const year = Number(c.req.query("year")) || Number(wibDate(new Date()).slice(0, 4));
  return c.json(await leaveBalance(db, employeeId, year));
});

const LeaveIn = z.object({
  type: z.string(),
  start: date,
  end: date,
  reason: z.string().max(500).optional(),
  reference: z.string().max(80).nullable().optional(),
  employee_id: z.number().int().optional(),
});

requests.post("/leave/preview", async (c) => {
  const user = c.get("user");
  const body = LeaveIn.parse(await c.req.json());
  const r = await previewLeave(db, forWhom(user, body.employee_id), body);
  return c.json({ days: r.days, unit: r.unit, errors: r.errors, warnings: r.warnings, balanceAfter: r.balanceAfter, balance: r.balance });
});

requests.post("/requests/leave", async (c) => {
  const user = c.get("user");
  const body = LeaveIn.parse(await c.req.json());
  const id = await requestLeave(db, {
    employeeId: forWhom(user, body.employee_id),
    initiatorId: user.employeeId,
    actor: user.email,
    type: body.type,
    start: body.start,
    end: body.end,
    reason: body.reason,
    reference: body.reference,
  });
  return c.json({ id }, 201);
});

const ResignIn = z.object({ last_day: date, reason: z.string().max(500).optional(), employee_id: z.number().int().optional() });

requests.post("/requests/resignation", async (c) => {
  const user = c.get("user");
  const body = ResignIn.parse(await c.req.json());
  const id = await requestResignation(db, {
    employeeId: forWhom(user, body.employee_id),
    initiatorId: user.employeeId,
    actor: user.email,
    lastDay: body.last_day,
    reason: body.reason,
  });
  return c.json({ id }, 201);
});

requests.post("/requests/onboarding", requireRole("HR_OPS", "ADMIN"), async (c) => {
  const user = c.get("user");
  const body = z.object({ employee_id: z.number().int() }).parse(await c.req.json());
  const id = await startOnboarding(db, { employeeId: body.employee_id, initiatorId: user.employeeId, actor: user.email });
  return c.json({ id }, 201);
});

// --- reading ----------------------------------------------------------------------------

const subject = aliasedTable(employees, "subject");

requests.get("/instances", async (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "mine";
  const conditions = [];
  if (scope === "all") {
    if (!hasRole(user, "HR_OPS", "ADMIN")) throw new HTTPException(403, { message: "Only HR can see every request" });
  } else if (scope === "team") {
    conditions.push(eq(subject.managerId, user.employeeId));
  } else {
    const touched = db.select({ id: tasks.instanceId }).from(tasks).where(or(eq(tasks.completedBy, user.employeeId), eq(tasks.assigneeEmployeeId, user.employeeId)));
    conditions.push(
      or(
        eq(workflowInstances.subjectEmployeeId, user.employeeId),
        eq(workflowInstances.initiatorEmployeeId, user.employeeId),
        ...(scope === "involved" ? [inArray(workflowInstances.id, touched)] : []),
      ),
    );
  }
  const key = c.req.query("key");
  const status = c.req.query("status");
  const q = c.req.query("q");
  if (key) conditions.push(eq(workflowInstances.key, key));
  if (status) conditions.push(eq(workflowInstances.status, status));
  if (q) conditions.push(or(ilike(workflowInstances.title, `%${q}%`), ilike(subject.employeeNo, `%${q}%`)));
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = 30;
  const where = conditions.length ? and(...conditions) : undefined;
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workflowInstances)
    .innerJoin(subject, eq(subject.id, workflowInstances.subjectEmployeeId))
    .where(where);
  const rows = await db
    .select({
      id: workflowInstances.id,
      key: workflowInstances.key,
      version: workflowInstances.version,
      title: workflowInstances.title,
      status: workflowInstances.status,
      startedAt: workflowInstances.startedAt,
      completedAt: workflowInstances.completedAt,
      subjectName: subject.fullName,
      subjectNo: subject.employeeNo,
      state: workflowInstances.state,
      simulated: workflowInstances.simulated,
    })
    .from(workflowInstances)
    .innerJoin(subject, eq(subject.id, workflowInstances.subjectEmployeeId))
    .where(where)
    .orderBy(desc(workflowInstances.startedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json({
    total: count?.n ?? 0,
    page,
    pageSize,
    items: rows.map(({ state, ...r }) => {
      const s = state as { cursor: string | null; open: { stepId: string }[]; waitUntil: string | null };
      return { ...r, cursor: s.cursor, waitUntil: s.waitUntil };
    }),
  });
});

requests.get("/instances/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const [inst] = await db
    .select({ i: workflowInstances, subjectName: subject.fullName, subjectNo: subject.employeeNo, subjectManager: subject.managerId, position: subject.position, location: subject.location })
    .from(workflowInstances)
    .innerJoin(subject, eq(subject.id, workflowInstances.subjectEmployeeId))
    .where(eq(workflowInstances.id, id));
  if (!inst) throw new HTTPException(404, { message: "Request not found" });

  const assignee = aliasedTable(employees, "assignee");
  const completer = aliasedTable(employees, "completer");
  const taskRows = await db
    .select({ t: tasks, assigneeName: assignee.fullName, completedByName: completer.fullName })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeEmployeeId))
    .leftJoin(completer, eq(completer.id, tasks.completedBy))
    .where(eq(tasks.instanceId, id))
    .orderBy(tasks.createdAt, tasks.id);

  const involved =
    hasRole(user, "HR_OPS", "ADMIN") ||
    inst.i.subjectEmployeeId === user.employeeId ||
    inst.i.initiatorEmployeeId === user.employeeId ||
    inst.subjectManager === user.employeeId ||
    taskRows.some(({ t }) => t.assigneeEmployeeId === user.employeeId || t.completedBy === user.employeeId || (t.assigneeRole && user.roles.includes(t.assigneeRole)));
  if (!involved) throw new HTTPException(404, { message: "Request not found" });

  const events = await db.select().from(instanceEvents).where(eq(instanceEvents.instanceId, id)).orderBy(instanceEvents.at, instanceEvents.id);
  const { def } = await definitionById(db, inst.i.definitionId);
  const state = inst.i.state as { context: Record<string, unknown>; cursor: string | null; visited: string[]; waitUntil: string | null };
  const isHr = hasRole(user, "HR_OPS", "ADMIN");
  return c.json({
    id: inst.i.id,
    key: inst.i.key,
    version: inst.i.version,
    title: inst.i.title,
    status: inst.i.status,
    startedAt: inst.i.startedAt,
    completedAt: inst.i.completedAt,
    simulated: inst.i.simulated,
    subject: { id: inst.i.subjectEmployeeId, name: inst.subjectName, employeeNo: inst.subjectNo, position: inst.position, location: inst.location },
    cursor: state.cursor,
    visited: state.visited,
    waitUntil: state.waitUntil,
    summary: summarise(inst.i.key, state.context),
    // Decisions and notes are part of the record; pay figures only for HR and the subject.
    context: isHr || inst.i.subjectEmployeeId === user.employeeId ? state.context : summarise(inst.i.key, state.context),
    definition: def,
    tasks: taskRows.map(({ t, assigneeName, completedByName }) => ({
      id: t.id,
      name: t.name,
      stepId: t.stepId,
      branchId: t.branchId,
      kind: t.kind,
      status: t.status,
      outcome: t.outcome,
      note: t.note,
      assignee: assigneeName ?? t.assigneeRole,
      completedBy: completedByName,
      createdAt: t.createdAt,
      dueAt: t.dueAt,
      originalDueAt: t.originalDueAt,
      completedAt: t.completedAt,
      escalationLevel: t.escalationLevel,
      slaHours: t.slaHours,
    })),
    events,
    canCancel: inst.i.status === "running" && (isHr || inst.i.initiatorEmployeeId === user.employeeId),
  });
});

requests.post("/instances/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.id, id));
  if (!inst) throw new HTTPException(404, { message: "Request not found" });
  if (!hasRole(user, "HR_OPS", "ADMIN") && inst.initiatorEmployeeId !== user.employeeId) {
    throw new HTTPException(403, { message: "Only the person who raised it, or HR, can cancel" });
  }
  const body = z.object({ reason: z.string().max(300).optional() }).parse(await c.req.json().catch(() => ({})));
  await cancelInstance({ instanceId: id, actor: user.email, reason: body.reason });
  return c.body(null, 204);
});

requests.get("/directory", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q") ?? "";
  const upcoming = c.req.query("upcoming") === "1";
  if (!hasRole(user, "HR_OPS", "ADMIN")) throw new HTTPException(403, { message: "Only HR can search the directory" });
  const rows = await db
    .select({ id: employees.id, employeeNo: employees.employeeNo, fullName: employees.fullName, position: employees.position, location: employees.location, hireDate: employees.hireDate, isActive: employees.isActive })
    .from(employees)
    .where(
      and(
        q ? or(ilike(employees.fullName, `%${q}%`), ilike(employees.employeeNo, `%${q}%`)) : undefined,
        upcoming ? sql`${employees.hireDate} > now()::date` : undefined,
      ),
    )
    .orderBy(employees.fullName)
    .limit(20);
  return c.json(rows);
});
