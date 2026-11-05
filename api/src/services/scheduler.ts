/**
 * The hourly tick, called by a GitHub Actions cron (and by admins from the UI). The API
 * scales to zero, so there is no in-process timer: anything time-based happens here.
 *
 *  1. Escalate overdue tasks and resume finished waits.
 *  2. Start PKWT renewals that have come within the lead time.
 *  3. Mark people inactive after their last day.
 *  4. Deliver queued webhooks, with retries and backoff.
 */
import { createHmac } from "node:crypto";

import { and, eq, isNull, lt, lte, sql } from "drizzle-orm";

import { db as defaultDb, type Db } from "../db/client.js";
import { employees, outbox, webhooks } from "../db/schema.js";
import { wibDate } from "../engine/calendar.js";
import { env } from "../env.js";
import { contractsDueForRenewal, startRenewal } from "./requests.js";
import { tickInstance } from "./runtime.js";

const MAX_ATTEMPTS = 5;

export interface TickReport {
  instancesAdvanced: number;
  renewalsStarted: number;
  deactivated: number;
  webhooksDelivered: number;
  webhooksFailed: number;
}

export async function runTick(now = new Date(), db: Db = defaultDb): Promise<TickReport> {
  const due = await db.execute<{ id: number }>(sql`
    SELECT w.id FROM workflow_instances w
    WHERE w.status = 'running' AND (
      EXISTS (SELECT 1 FROM tasks t WHERE t.instance_id = w.id AND t.status = 'open'
              AND t.due_at <= ${now.toISOString()} AND t.escalation_level < 2)
      OR (w.state ->> 'waitUntil') <= ${now.toISOString()}
    )
  `);
  let instancesAdvanced = 0;
  for (const row of due) if ((await tickInstance(row.id, now, db)) > 0) instancesAdvanced++;

  let renewalsStarted = 0;
  for (const employeeId of await contractsDueForRenewal(db, now)) {
    await startRenewal(db, employeeId, now);
    renewalsStarted++;
  }

  const deactivated = await db
    .update(employees)
    .set({ isActive: false })
    .where(and(eq(employees.isActive, true), lt(employees.lastDay, wibDate(now))))
    .returning({ id: employees.id });

  const delivery = await deliverWebhooks(now, db);
  return { instancesAdvanced, renewalsStarted, deactivated: deactivated.length, ...delivery };
}

export function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Microsoft Teams (Workflows) and Power Automate accept an Adaptive Card in this envelope. */
export function adaptiveCard(payload: Record<string, unknown>) {
  const instance = (payload.instance ?? {}) as Record<string, unknown>;
  const task = (payload.task ?? null) as Record<string, unknown> | null;
  const facts = [
    { title: "Workflow", value: String(instance.workflow ?? "") },
    { title: "Status", value: String(instance.status ?? "") },
    ...(task ? [{ title: "Task", value: String(task.name ?? "") }] : []),
    ...(task?.due_at ? [{ title: "Due", value: String(task.due_at) }] : []),
  ];
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: String(payload.event), weight: "Bolder", size: "Medium" },
            { type: "TextBlock", text: String(instance.title ?? ""), wrap: true },
            { type: "FactSet", facts },
          ],
          actions: [{ type: "Action.OpenUrl", title: "Open", url: `${env.PUBLIC_APP_URL}/requests/${instance.id}` }],
        },
      },
    ],
  };
}

async function deliverWebhooks(now: Date, db: Db) {
  const pending = await db
    .select({ o: outbox, w: webhooks })
    .from(outbox)
    .innerJoin(webhooks, eq(webhooks.id, outbox.webhookId))
    .where(and(isNull(outbox.deliveredAt), lte(outbox.deliverAfter, now), lt(outbox.attempts, MAX_ATTEMPTS)))
    .limit(50);
  let delivered = 0;
  let failed = 0;
  for (const { o, w } of pending) {
    const payload = o.payload as Record<string, unknown>;
    const body = JSON.stringify(w.format === "adaptive_card" ? adaptiveCard(payload) : payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(w.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-arunika-event": o.event,
          "x-arunika-delivery": String(o.id),
          "x-arunika-signature": sign(w.secret, body),
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const attempts = o.attempts + 1;
    if (!error) delivered++;
    else failed++;
    await db
      .update(outbox)
      .set({
        attempts,
        lastStatus: status,
        lastError: error,
        deliveredAt: error ? null : now,
        // Exponential backoff: 1, 2, 4, 8 minutes.
        deliverAfter: error ? new Date(now.getTime() + 60_000 * 2 ** (attempts - 1)) : o.deliverAfter,
      })
      .where(eq(outbox.id, o.id));
  }
  return { webhooksDelivered: delivered, webhooksFailed: failed };
}
