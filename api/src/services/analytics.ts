/**
 * Process analytics over tasks and instances. Durations are in working hours (WIB,
 * holidays excluded), the same clock the SLAs run on, so "met SLA" means what the
 * assignee experienced rather than what the wall clock says.
 */
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { employees, tasks, workflowInstances } from "../db/schema.js";
import { workingHoursBetween, type WorkCalendar } from "../engine/calendar.js";

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export async function workflowSummary(db: DbOrTx, cal: WorkCalendar, since: Date) {
  const rows = await db
    .select({
      key: workflowInstances.key,
      status: workflowInstances.status,
      startedAt: workflowInstances.startedAt,
      completedAt: workflowInstances.completedAt,
    })
    .from(workflowInstances)
    .where(gte(workflowInstances.startedAt, since));
  const byKey = new Map<string, { started: number; running: number; finished: number; rejected: number; cancelled: number; cycle: number[] }>();
  for (const r of rows) {
    const s = byKey.get(r.key) ?? { started: 0, running: 0, finished: 0, rejected: 0, cancelled: 0, cycle: [] };
    s.started++;
    if (r.status === "running") s.running++;
    else s.finished++;
    if (r.status === "rejected") s.rejected++;
    if (r.status === "cancelled") s.cancelled++;
    if (r.completedAt && r.status !== "cancelled") s.cycle.push(workingHoursBetween(r.startedAt, r.completedAt, cal));
    byKey.set(r.key, s);
  }
  return [...byKey.entries()].map(([key, s]) => {
    const sorted = s.cycle.sort((a, b) => a - b);
    return {
      key,
      started: s.started,
      running: s.running,
      finished: s.finished,
      rejection_rate: s.finished ? Math.round((1000 * s.rejected) / s.finished) / 10 : null,
      cycle_median_hours: round1(quantile(sorted, 0.5)),
      cycle_p90_hours: round1(quantile(sorted, 0.9)),
    };
  });
}

export async function stepStats(db: DbOrTx, cal: WorkCalendar, key: string, since: Date) {
  const rows = await db
    .select({
      stepId: tasks.stepId,
      branchId: tasks.branchId,
      name: tasks.name,
      kind: tasks.kind,
      rule: tasks.assigneeRule,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      originalDueAt: tasks.originalDueAt,
      escalationLevel: tasks.escalationLevel,
      status: tasks.status,
    })
    .from(tasks)
    .innerJoin(workflowInstances, eq(workflowInstances.id, tasks.instanceId))
    .where(and(eq(workflowInstances.key, key), gte(tasks.createdAt, since), inArray(tasks.status, ["open", "completed"])));

  const now = new Date();
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const id = r.branchId ?? r.stepId;
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  return [...groups.entries()].map(([id, list]) => {
    const done = list.filter((r) => r.completedAt);
    const hours = done.map((r) => workingHoursBetween(r.createdAt, r.completedAt!, cal)).sort((a, b) => a - b);
    const metSla = done.filter((r) => r.completedAt! <= r.originalDueAt).length;
    const open = list.filter((r) => !r.completedAt);
    return {
      step: id,
      name: list[0]!.name,
      kind: list[0]!.kind,
      assignee: list[0]!.rule,
      tasks: list.length,
      completed: done.length,
      open: open.length,
      overdue_open: open.filter((r) => r.originalDueAt < now).length,
      median_hours: round1(quantile(hours, 0.5)),
      p90_hours: round1(quantile(hours, 0.9)),
      sla_met_pct: done.length ? Math.round((1000 * metSla) / done.length) / 10 : null,
      escalated: list.filter((r) => r.escalationLevel > 0).length,
    };
  });
}

/** One step, split by the subject's office: where a bottleneck usually shows itself. */
export async function stepByLocation(db: DbOrTx, cal: WorkCalendar, key: string, step: string, since: Date) {
  const rows = await db
    .select({ location: employees.location, createdAt: tasks.createdAt, completedAt: tasks.completedAt, originalDueAt: tasks.originalDueAt })
    .from(tasks)
    .innerJoin(workflowInstances, eq(workflowInstances.id, tasks.instanceId))
    .innerJoin(employees, eq(employees.id, workflowInstances.subjectEmployeeId))
    .where(
      and(
        eq(workflowInstances.key, key),
        sql`coalesce(${tasks.branchId}, ${tasks.stepId}) = ${step}`,
        gte(tasks.createdAt, since),
        isNotNull(tasks.completedAt),
      ),
    );
  const groups = new Map<string, { hours: number[]; met: number }>();
  for (const r of rows) {
    const g = groups.get(r.location) ?? { hours: [], met: 0 };
    g.hours.push(workingHoursBetween(r.createdAt, r.completedAt!, cal));
    if (r.completedAt! <= r.originalDueAt) g.met++;
    groups.set(r.location, g);
  }
  return [...groups.entries()]
    .map(([location, g]) => {
      const sorted = g.hours.sort((a, b) => a - b);
      return {
        location,
        tasks: sorted.length,
        median_hours: round1(quantile(sorted, 0.5)),
        sla_met_pct: Math.round((1000 * g.met) / sorted.length) / 10,
      };
    })
    .sort((a, b) => (b.median_hours ?? 0) - (a.median_hours ?? 0));
}

/** Instances started and finished per ISO week. */
export async function weeklyThroughput(db: DbOrTx, since: Date) {
  const rows = await db.execute<{ week: string; started: number; finished: number }>(sql`
    WITH weeks AS (
      SELECT generate_series(date_trunc('week', ${since.toISOString()}::timestamptz),
                             date_trunc('week', now()), interval '1 week') AS week
    )
    SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
      (SELECT count(*)::int FROM workflow_instances i WHERE date_trunc('week', i.started_at) = w.week) AS started,
      (SELECT count(*)::int FROM workflow_instances i WHERE date_trunc('week', i.completed_at) = w.week) AS finished
    FROM weeks w ORDER BY w.week
  `);
  return [...rows];
}
