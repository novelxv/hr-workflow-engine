/**
 * End-to-end behaviour against a seeded database (DATABASE_URL). These tests add their own
 * requests with dates far enough ahead not to collide with the seeded history.
 * Seed first with:  npm run seed
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { and, desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app } from "../src/app.js";
import { db } from "../src/db/client.js";
import { employees, instanceEvents, notifications, outbox, tasks, users, webhooks, workflowInstances } from "../src/db/schema.js";
import { env } from "../src/env.js";
import { sign, runTick } from "../src/services/scheduler.js";
import { startInstance } from "../src/services/runtime.js";

const hasDb = !!process.env.DATABASE_URL || !!env.DATABASE_URL;
const PASSWORD = env.DEMO_PASSWORD;

async function signIn(who: string): Promise<string> {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${who}@arunikalife.example`, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function call(cookie: string, path: string, init: RequestInit = {}) {
  return app.request(path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });
}

// A random Monday-Tuesday between 2027 and 2030, so repeated runs against the same
// database rarely pick dates that overlap an earlier run's requests.
function futureWeek() {
  const day = 7 + Math.floor(Math.random() * 1400);
  const d = new Date(Date.UTC(2027, 0, 1 + day));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const mon = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 1);
  return { start: mon, end: d.toISOString().slice(0, 10) };
}

describe.skipIf(!hasDb)("API", () => {
  let employee: string;
  let manager: string;
  let admin: string;

  beforeAll(async () => {
    [employee, manager, admin] = await Promise.all([signIn("employee"), signIn("manager"), signIn("admin")]);
  });

  it("rejects a wrong password and unauthenticated calls", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "manager@arunikalife.example", password: "nope" }),
    });
    expect(res.status).toBe(401);
    expect((await app.request("/inbox")).status).toBe(401);
  });

  it("runs a leave request from submission to approval and tells the employee", async () => {
    const { start, end } = futureWeek();
    const created = await call(employee, "/requests/leave", {
      method: "POST",
      body: JSON.stringify({ type: "child_ceremony", start, end, reason: "Son's circumcision" }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: number };

    const inbox = (await (await call(manager, "/inbox")).json()) as { tasks: { id: number; instanceId: number; summary: { days: number } }[] };
    const task = inbox.tasks.find((t) => t.instanceId === id)!;
    expect(task.summary.days).toBe(2);

    expect((await call(employee, `/tasks/${task.id}/complete`, { method: "POST", body: JSON.stringify({ outcome: "approved" }) })).status).toBe(403);
    expect((await call(manager, `/tasks/${task.id}/complete`, { method: "POST", body: JSON.stringify({ outcome: "rejected" }) })).status).toBe(422);
    const ok = await call(manager, `/tasks/${task.id}/complete`, { method: "POST", body: JSON.stringify({ outcome: "approved" }) });
    expect(ok.status).toBe(200);

    const detail = (await (await call(employee, `/instances/${id}`)).json()) as { status: string; events: { type: string }[] };
    expect(detail.status).toBe("approved");
    expect(detail.events.map((e) => e.type)).toContain("finished");

    const me = (await (await call(employee, "/auth/me")).json()) as { employeeId: number };
    const [note] = await db.select().from(notifications).where(eq(notifications.employeeId, me.employeeId)).orderBy(desc(notifications.id)).limit(1);
    expect(note!.title).toBe("Leave approved");
  });

  it("refuses leave the rules do not allow", async () => {
    const res = await call(employee, "/requests/leave", {
      method: "POST",
      body: JSON.stringify({ type: "marriage", start: "2027-02-01", end: "2027-02-05" }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/at most 3 working days/);
  });

  it("escalates an overdue approval on the scheduler tick", async () => {
    const [emp] = await db.select().from(users).where(eq(users.email, "employee@arunikalife.example"));
    const { start, end } = futureWeek();
    const raisedAt = new Date(Date.now() - 10 * 86_400_000);
    const id = await startInstance({
      key: "leave_request",
      subjectId: emp!.employeeId,
      initiatorId: emp!.employeeId,
      title: `Test leave ${start}`,
      context: { leave_type: "child_ceremony", start_date: start, end_date: end, days: 2, manager_is_head: false },
      now: raisedAt,
      actor: "test",
    });
    await runTick(new Date());
    const [task] = await db.select().from(tasks).where(eq(tasks.instanceId, id));
    expect(task!.escalationLevel).toBeGreaterThanOrEqual(1);
    const events = await db.select().from(instanceEvents).where(and(eq(instanceEvents.instanceId, id), eq(instanceEvents.type, "escalated")));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  describe("webhooks", () => {
    let server: Server;
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          received.push({ headers: req.headers, body });
          res.writeHead(204).end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    });
    afterAll(() => server.close());

    it("delivers signed events from the outbox", async () => {
      const port = (server.address() as AddressInfo).port;
      // Inserted directly: the API only accepts https URLs.
      const [hook] = await db
        .insert(webhooks)
        .values({ name: "test receiver", url: `http://127.0.0.1:${port}/hook`, secret: "test-secret", events: ["task.created"], format: "json" })
        .returning();
      try {
        const { start, end } = futureWeek();
        const res = await call(employee, "/requests/leave", { method: "POST", body: JSON.stringify({ type: "child_ceremony", start, end }) });
        expect(res.status, await res.clone().text()).toBe(201);
        const queued = await db.select().from(outbox).where(eq(outbox.webhookId, hook!.id));
        expect(queued).toHaveLength(1);
        await runTick(new Date());
        expect(received).toHaveLength(1);
        expect(received[0]!.headers["x-arunika-signature"]).toBe(sign("test-secret", received[0]!.body));
        expect(JSON.parse(received[0]!.body).event).toBe("task.created");
        const [after] = await db.select().from(outbox).where(eq(outbox.webhookId, hook!.id));
        expect(after!.deliveredAt).not.toBeNull();
      } finally {
        await db.update(webhooks).set({ active: false }).where(eq(webhooks.id, hook!.id));
      }
    });
  });

  it("starts onboarding from a signed HRIS event and rejects a bad signature", async () => {
    const no = `AL-T${Date.now().toString().slice(-6)}`;
    const body = JSON.stringify({
      type: "employee.hired",
      employee: {
        employee_no: no,
        full_name: "Test Joiner",
        email: `${no.toLowerCase()}@arunikalife.example`,
        gender: "F",
        department_code: "CLM",
        location: "Jakarta",
        position: "Claims Analyst",
        grade: "G2",
        manager_employee_no: null,
        hire_date: "2027-03-01",
        employment_type: "PKWTT",
        probation_months: 3,
        monthly_wage: 8_000_000,
      },
    });
    const bad = await app.request("/hooks/hris", { method: "POST", body, headers: { "x-arunika-signature": "sha256=00" } });
    expect(bad.status).toBe(401);
    const res = await app.request("/hooks/hris", { method: "POST", body, headers: { "x-arunika-signature": sign(env.HOOK_SECRET, body) } });
    expect(res.status).toBe(202);
    const [emp] = await db.select().from(employees).where(eq(employees.employeeNo, no));
    const [inst] = await db.select().from(workflowInstances).where(eq(workflowInstances.subjectEmployeeId, emp!.id));
    expect(inst!.key).toBe("onboarding");
  });

  it("publishes a new version without touching running instances", async () => {
    const versions = (await (await call(admin, "/definitions/offboarding")).json()) as { version: number; definition: { steps: { id: string; slaHours?: number }[] } }[];
    const latest = versions[0]!;
    const running = await db
      .select({ version: workflowInstances.version })
      .from(workflowInstances)
      .where(and(eq(workflowInstances.key, "offboarding"), eq(workflowInstances.status, "running")));

    const invalid = await call(admin, "/definitions/offboarding/versions", {
      method: "POST",
      body: JSON.stringify({ definition: { ...latest.definition, steps: latest.definition.steps.slice(0, 1) } }),
    });
    expect(invalid.status).toBe(422);

    const next = structuredClone(latest.definition);
    const ack = next.steps.find((s) => s.id === "manager_ack")!;
    ack.slaHours = 8;
    const published = await call(admin, "/definitions/offboarding/versions", {
      method: "POST",
      body: JSON.stringify({ definition: next, note: "Faster acknowledgement" }),
    });
    expect(published.status).toBe(201);
    expect(((await published.json()) as { version: number }).version).toBe(latest.version + 1);

    const after = await db
      .select({ version: workflowInstances.version })
      .from(workflowInstances)
      .where(and(eq(workflowInstances.key, "offboarding"), eq(workflowInstances.status, "running")));
    expect(after.map((r) => r.version).sort()).toEqual(running.map((r) => r.version).sort());
  });

  it("keeps analytics for HR only", async () => {
    expect((await call(employee, "/analytics/summary")).status).toBe(403);
    const res = await call(admin, "/analytics/summary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { key: string }[] };
    expect(body.summary.map((s) => s.key)).toContain("leave_request");
  });
});

afterAll(async () => {
  await db.execute(sql`SELECT 1`);
});
