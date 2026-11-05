/**
 * Runs the pure engine against the database.
 *
 * Every public function opens one transaction: load the instance (row-locked), call the
 * engine, apply its effects, save the new state. Webhook deliveries are only queued here
 * (transactional outbox); the scheduler sends them, so a slow receiver never holds a
 * transaction open and a rolled-back step never notifies anyone.
 */
import { and, eq } from "drizzle-orm";

import { db as defaultDb, type Db, type Tx } from "../db/client.js";
import {
  instanceEvents,
  notifications,
  outbox,
  tasks,
  webhooks,
  workflowInstances,
} from "../db/schema.js";
import { wibDate, type WorkCalendar } from "../engine/calendar.js";
import {
  advance,
  EngineError,
  start,
  type Effect,
  type EngineEvent,
  type InstanceState,
} from "../engine/engine.js";
import type { Definition } from "../engine/schema.js";
import { ACTIONS } from "./actions.js";
import { resolveAssignee, resolveEscalation, type Resolved } from "./assign.js";
import { definitionById, latestDefinition, loadCalendar, loadDirectory, type LoadedDirectory } from "./directory.js";
import { render } from "./templates.js";

export class RuntimeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type InstanceRow = typeof workflowInstances.$inferSelect;

interface Env {
  tx: Tx;
  now: Date;
  dir: LoadedDirectory;
  calendar: WorkCalendar;
  actor: string;
}

export async function startInstance(
  args: {
    key: string;
    subjectId: number;
    initiatorId: number | null;
    title: string;
    context: Record<string, unknown>;
    now?: Date;
    actor: string;
  },
  db: Db = defaultDb,
): Promise<number> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const { row, def } = await latestDefinition(tx, args.key);
    const env: Env = { tx, now, dir: await loadDirectory(tx), calendar: await loadCalendar(tx), actor: args.actor };
    const result = start(def, args.context, { calendar: env.calendar, now });
    const [inst] = await tx
      .insert(workflowInstances)
      .values({
        definitionId: row.id,
        key: def.key,
        version: row.version,
        title: args.title,
        subjectEmployeeId: args.subjectId,
        initiatorEmployeeId: args.initiatorId,
        status: result.state.status,
        state: result.state,
        startedAt: now,
        completedAt: result.state.status === "running" ? null : now,
      })
      .returning();
    await tx.insert(instanceEvents).values({ instanceId: inst!.id, at: now, type: "started", actor: args.actor, data: {} });
    await applyEffects(env, inst!, def, result.state, result.effects);
    return inst!.id;
  });
}

async function lockInstance(tx: Tx, id: number): Promise<InstanceRow> {
  const [inst] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, id)).for("update");
  if (!inst) throw new RuntimeError("Request not found", 404);
  return inst;
}

async function step(env: Env, inst: InstanceRow, event: EngineEvent) {
  const { def } = await definitionById(env.tx, inst.definitionId);
  const result = advance(def, inst.state as InstanceState, event, { calendar: env.calendar, now: env.now });
  await applyEffects(env, inst, def, result.state, result.effects);
  return result;
}

export async function completeTask(
  args: { taskId: number; actorEmployeeId: number; outcome: string; note?: string; now?: Date; actor: string },
  db: Db = defaultDb,
) {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, args.taskId)).for("update");
    if (!task) throw new RuntimeError("Task not found", 404);
    if (task.status !== "open") throw new RuntimeError("This task is already closed", 409);
    const inst = await lockInstance(tx, task.instanceId);
    const env: Env = { tx, now, dir: await loadDirectory(tx), calendar: await loadCalendar(tx), actor: args.actor };
    await tx
      .update(tasks)
      .set({ status: "completed", outcome: args.outcome, note: args.note ?? null, completedAt: now, completedBy: args.actorEmployeeId })
      .where(eq(tasks.id, task.id));
    await tx.insert(instanceEvents).values({
      instanceId: inst.id,
      at: now,
      type: "task_completed",
      actor: args.actor,
      data: { task: task.name, outcome: args.outcome, note: args.note ?? null },
    });
    try {
      await step(env, inst, {
        type: "complete_task",
        key: task.taskKey,
        outcome: args.outcome,
        by: String(args.actorEmployeeId),
        note: args.note,
      });
    } catch (e) {
      if (e instanceof EngineError) throw new RuntimeError(e.message, 422);
      throw e;
    }
    return inst.id;
  });
}

export async function cancelInstance(
  args: { instanceId: number; actor: string; reason?: string; now?: Date },
  db: Db = defaultDb,
) {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const inst = await lockInstance(tx, args.instanceId);
    if (inst.status !== "running") throw new RuntimeError(`This request is already ${inst.status}`, 409);
    const env: Env = { tx, now, dir: await loadDirectory(tx), calendar: await loadCalendar(tx), actor: args.actor };
    await tx.insert(instanceEvents).values({ instanceId: inst.id, at: now, type: "cancel_requested", actor: args.actor, data: { reason: args.reason ?? null } });
    await step(env, inst, { type: "cancel", by: args.actor, reason: args.reason });
  });
}

/** Advance one instance on the scheduler's tick (escalations, finished waits). */
export async function tickInstance(instanceId: number, now: Date, db: Db = defaultDb) {
  return db.transaction(async (tx) => {
    const inst = await lockInstance(tx, instanceId);
    if (inst.status !== "running") return 0;
    const env: Env = { tx, now, dir: await loadDirectory(tx), calendar: await loadCalendar(tx), actor: "system:scheduler" };
    const result = await step(env, inst, { type: "tick" });
    return result.effects.length;
  });
}

// --- effects ----------------------------------------------------------------------------

async function notify(env: Env, inst: InstanceRow, employeeId: number, template: string, state: InstanceState, taskName?: string) {
  const subject = env.dir.person(inst.subjectEmployeeId);
  const msg = render(template, {
    instanceId: inst.id,
    instanceTitle: inst.title,
    subjectName: subject?.fullName ?? "",
    context: state.context,
    taskName,
  });
  await env.tx.insert(notifications).values({ employeeId, at: env.now, title: msg.title, body: msg.body, link: msg.link });
}

async function queueWebhooks(env: Env, event: string, payload: Record<string, unknown>) {
  const hooks = await env.tx.select().from(webhooks).where(eq(webhooks.active, true));
  const targets = hooks.filter((h) => h.events.includes(event) || h.events.includes("*"));
  if (targets.length === 0) return;
  await env.tx.insert(outbox).values(
    targets.map((h) => ({
      createdAt: env.now,
      webhookId: h.id,
      event,
      payload: { event, at: env.now.toISOString(), ...payload },
      deliverAfter: env.now,
    })),
  );
}

function instanceSummary(env: Env, inst: InstanceRow, status: string) {
  const subject = env.dir.person(inst.subjectEmployeeId);
  return { id: inst.id, workflow: inst.key, version: inst.version, title: inst.title, status, subject: subject?.fullName ?? null };
}

async function applyEffects(env: Env, inst: InstanceRow, def: Definition, state: InstanceState, effects: Effect[]) {
  const { tx, now } = env;
  const ctx = { subjectId: inst.subjectEmployeeId, initiatorId: inst.initiatorEmployeeId };
  for (const e of effects) {
    switch (e.type) {
      case "create_task": {
        const who: Resolved = resolveAssignee(e.assignee, ctx, env.dir);
        await tx.insert(tasks).values({
          instanceId: inst.id,
          taskKey: e.key,
          stepId: e.stepId,
          branchId: e.branchId ?? null,
          kind: e.kind,
          name: e.name,
          assigneeEmployeeId: who.employeeId,
          assigneeRole: who.role,
          assigneeRule: e.assignee,
          status: "open",
          checklist: e.checklist ?? null,
          options: e.options ?? null,
          instructions: e.instructions ?? null,
          slaHours: e.slaHours,
          createdAt: now,
          dueAt: new Date(e.dueAt),
          originalDueAt: new Date(e.dueAt),
        });
        if (who.employeeId !== null) await notify(env, inst, who.employeeId, "task_assigned", state, e.name);
        await queueWebhooks(env, "task.created", {
          instance: instanceSummary(env, inst, state.status),
          task: { name: e.name, kind: e.kind, due_at: e.dueAt, assignee_role: who.role, assignee: who.employeeId ? env.dir.person(who.employeeId)?.fullName : null },
        });
        break;
      }
      case "cancel_task":
        await tx
          .update(tasks)
          .set({ status: "cancelled", completedAt: now })
          .where(and(eq(tasks.instanceId, inst.id), eq(tasks.taskKey, e.key)));
        break;
      case "escalate_task": {
        const [task] = await tx.select().from(tasks).where(and(eq(tasks.instanceId, inst.id), eq(tasks.taskKey, e.key)));
        if (!task) break;
        const next = resolveEscalation(e.to, { employeeId: task.assigneeEmployeeId, role: task.assigneeRole }, ctx, env.dir);
        await tx
          .update(tasks)
          .set({ assigneeEmployeeId: next.employeeId, assigneeRole: next.role, dueAt: new Date(e.dueAt), escalationLevel: e.level, escalatedAt: now })
          .where(eq(tasks.id, task.id));
        await tx.insert(instanceEvents).values({
          instanceId: inst.id,
          at: now,
          type: "escalated",
          actor: "system:scheduler",
          data: {
            task: task.name,
            level: e.level,
            from: task.assigneeEmployeeId ? env.dir.person(task.assigneeEmployeeId)?.fullName : task.assigneeRole,
            to: next.employeeId ? env.dir.person(next.employeeId)?.fullName : next.role,
          },
        });
        if (next.employeeId !== null) await notify(env, inst, next.employeeId, "task_escalated", state, task.name);
        await queueWebhooks(env, "task.escalated", {
          instance: instanceSummary(env, inst, state.status),
          task: { name: task.name, level: e.level, due_at: e.dueAt },
        });
        break;
      }
      case "notify": {
        const who = resolveAssignee(e.to, ctx, env.dir);
        if (who.employeeId !== null) await notify(env, inst, who.employeeId, e.template, state);
        break;
      }
      case "action": {
        const run = ACTIONS[e.action];
        if (!run) throw new RuntimeError(`Unknown action ${e.action} in ${def.key}`, 500);
        await run(tx, { subjectId: inst.subjectEmployeeId, context: state.context, today: wibDate(now) });
        await tx.insert(instanceEvents).values({ instanceId: inst.id, at: now, type: "action", actor: env.actor, data: { action: e.action } });
        break;
      }
      case "step_entered":
        await tx.insert(instanceEvents).values({ instanceId: inst.id, at: now, type: "step_entered", actor: null, data: { step: e.stepId, stepType: e.stepType } });
        break;
      case "waiting":
        await tx.insert(instanceEvents).values({ instanceId: inst.id, at: now, type: "waiting", actor: null, data: { step: e.stepId, until: e.until } });
        break;
      case "finished":
        await tx.insert(instanceEvents).values({ instanceId: inst.id, at: now, type: "finished", actor: null, data: { status: e.status, step: e.stepId } });
        await queueWebhooks(env, `instance.${e.status}`, { instance: instanceSummary(env, inst, e.status) });
        break;
    }
  }
  await tx
    .update(workflowInstances)
    .set({ state, status: state.status, completedAt: state.status === "running" ? null : now })
    .where(eq(workflowInstances.id, inst.id));
}
