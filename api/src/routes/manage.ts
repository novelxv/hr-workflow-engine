/** Definitions, analytics, administration, the scheduler hook and inbound HRIS events. */
import { createHmac, timingSafeEqual } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { requireRole, requireUser, type AppEnv } from "../auth.js";
import { db } from "../db/client.js";
import { employees, holidays, outbox, webhooks, workflowDefinitions, workflowInstances } from "../db/schema.js";
import { Definition } from "../engine/schema.js";
import { env } from "../env.js";
import { stepByLocation, stepStats, weeklyThroughput, workflowSummary } from "../services/analytics.js";
import { loadCalendar } from "../services/directory.js";
import { startOnboarding } from "../services/requests.js";
import { runTick, sign } from "../services/scheduler.js";

export const manage = new Hono<AppEnv>();

// --- definitions ------------------------------------------------------------------------

manage.get("/definitions", requireUser, async (c) => {
  const rows = await db.select().from(workflowDefinitions).orderBy(asc(workflowDefinitions.key), asc(workflowDefinitions.version));
  const counts = await db.select({ definitionId: workflowInstances.definitionId, status: workflowInstances.status }).from(workflowInstances);
  const byKey = new Map<string, { latest: (typeof rows)[number]; versions: number; running: number; total: number }>();
  for (const r of rows) {
    const cur = byKey.get(r.key) ?? { latest: r, versions: 0, running: 0, total: 0 };
    cur.latest = r;
    cur.versions++;
    byKey.set(r.key, cur);
  }
  for (const i of counts) {
    const def = rows.find((r) => r.id === i.definitionId);
    const cur = def && byKey.get(def.key);
    if (!cur) continue;
    cur.total++;
    if (i.status === "running") cur.running++;
  }
  return c.json(
    [...byKey.values()].map((v) => ({
      key: v.latest.key,
      name: v.latest.name,
      version: v.latest.version,
      versions: v.versions,
      running: v.running,
      total: v.total,
      definition: v.latest.definition,
      publishedAt: v.latest.publishedAt,
    })),
  );
});

manage.get("/definitions/:key", requireUser, async (c) => {
  const rows = await db
    .select()
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.key, c.req.param("key")))
    .orderBy(desc(workflowDefinitions.version));
  if (!rows.length) throw new HTTPException(404, { message: "Workflow not found" });
  return c.json(rows);
});

manage.post("/definitions/:key/versions", requireUser, requireRole("ADMIN"), async (c) => {
  const user = c.get("user");
  const body = z.object({ definition: z.unknown(), note: z.string().max(300).optional() }).parse(await c.req.json());
  const parsed = Definition.safeParse(body.definition);
  if (!parsed.success) {
    return c.json({ error: "The definition is not valid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 422);
  }
  if (parsed.data.key !== c.req.param("key")) throw new HTTPException(422, { message: "The key cannot change between versions" });
  const [latest] = await db
    .select()
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.key, parsed.data.key))
    .orderBy(desc(workflowDefinitions.version))
    .limit(1);
  if (!latest) throw new HTTPException(404, { message: "Workflow not found" });
  const [row] = await db
    .insert(workflowDefinitions)
    .values({ key: parsed.data.key, version: latest.version + 1, name: parsed.data.name, definition: parsed.data, publishedBy: user.email, note: body.note ?? null })
    .returning();
  return c.json(row, 201);
});

// --- analytics --------------------------------------------------------------------------

function since(c: { req: { query: (k: string) => string | undefined } }) {
  const days = Math.min(365, Math.max(7, Number(c.req.query("days")) || 182));
  return new Date(Date.now() - days * 86_400_000);
}

manage.get("/analytics/summary", requireUser, requireRole("HR_OPS", "ADMIN"), async (c) => {
  const cal = await loadCalendar(db);
  const from = since(c);
  const [summary, weekly] = await Promise.all([workflowSummary(db, cal, from), weeklyThroughput(db, from)]);
  return c.json({ since: from, summary, weekly });
});

manage.get("/analytics/steps/:key", requireUser, requireRole("HR_OPS", "ADMIN"), async (c) => {
  const cal = await loadCalendar(db);
  return c.json(await stepStats(db, cal, c.req.param("key"), since(c)));
});

manage.get("/analytics/steps/:key/:step/by-location", requireUser, requireRole("HR_OPS", "ADMIN"), async (c) => {
  const cal = await loadCalendar(db);
  return c.json(await stepByLocation(db, cal, c.req.param("key"), c.req.param("step"), since(c)));
});

// --- administration ---------------------------------------------------------------------

manage.get("/admin/holidays", requireUser, async (c) => c.json(await db.select().from(holidays).orderBy(holidays.date)));

manage.post("/admin/holidays", requireUser, requireRole("ADMIN"), async (c) => {
  const body = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(2), kind: z.enum(["national", "cuti_bersama"]) })
    .parse(await c.req.json());
  await db.insert(holidays).values(body).onConflictDoUpdate({ target: holidays.date, set: { name: body.name, kind: body.kind } });
  return c.json(body, 201);
});

manage.delete("/admin/holidays/:date", requireUser, requireRole("ADMIN"), async (c) => {
  await db.delete(holidays).where(eq(holidays.date, c.req.param("date")));
  return c.body(null, 204);
});

manage.get("/admin/webhooks", requireUser, requireRole("ADMIN"), async (c) => {
  const rows = await db.select().from(webhooks).orderBy(webhooks.id);
  return c.json(rows.map(({ secret, ...w }) => ({ ...w, secretHint: `…${secret.slice(-4)}` })));
});

const WebhookIn = z.object({
  name: z.string().min(2),
  url: z.string().url().refine((u) => u.startsWith("https://"), "Use an https URL"),
  events: z.array(z.string()).min(1),
  format: z.enum(["json", "adaptive_card"]),
});

manage.post("/admin/webhooks", requireUser, requireRole("ADMIN"), async (c) => {
  const body = WebhookIn.parse(await c.req.json());
  const secret = createHmac("sha256", env.JWT_SECRET).update(`${body.url}:${Date.now()}`).digest("hex").slice(0, 40);
  const [row] = await db.insert(webhooks).values({ ...body, secret }).returning();
  // The secret is shown once, on creation, so the receiver can verify signatures.
  return c.json({ ...row, secret }, 201);
});

manage.delete("/admin/webhooks/:id", requireUser, requireRole("ADMIN"), async (c) => {
  await db.update(webhooks).set({ active: false }).where(eq(webhooks.id, Number(c.req.param("id"))));
  return c.body(null, 204);
});

manage.get("/admin/outbox", requireUser, requireRole("ADMIN"), async (c) => {
  const rows = await db
    .select({ o: outbox, name: webhooks.name, url: webhooks.url })
    .from(outbox)
    .innerJoin(webhooks, eq(webhooks.id, outbox.webhookId))
    .orderBy(desc(outbox.id))
    .limit(50);
  return c.json(rows.map(({ o, name, url }) => ({ ...o, webhook: name, url })));
});

manage.post("/admin/tick", requireUser, requireRole("ADMIN"), async (c) => c.json(await runTick()));

// Called by the scheduled GitHub Action.
manage.post("/internal/tick", async (c) => {
  const token = c.req.header("x-internal-token") ?? "";
  const expected = env.INTERNAL_TOKEN;
  if (!expected || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    throw new HTTPException(401, { message: "Bad token" });
  }
  return c.json(await runTick());
});

// --- inbound events from the HRIS -------------------------------------------------------

const Hired = z.object({
  type: z.literal("employee.hired"),
  employee: z.object({
    employee_no: z.string(),
    full_name: z.string(),
    email: z.string().email(),
    gender: z.enum(["F", "M"]),
    department_code: z.string(),
    location: z.string(),
    position: z.string(),
    grade: z.string(),
    manager_employee_no: z.string().nullable(),
    hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    employment_type: z.enum(["PKWT", "PKWTT"]),
    probation_months: z.number().int().min(0).max(3).default(0),
    monthly_wage: z.number().int().positive(),
  }),
});

manage.post("/hooks/hris", async (c) => {
  const raw = await c.req.text();
  const given = c.req.header("x-arunika-signature") ?? "";
  const expected = env.HOOK_SECRET ? sign(env.HOOK_SECRET, raw) : "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    throw new HTTPException(401, { message: "Signature does not match" });
  }
  const event = Hired.parse(JSON.parse(raw));
  const e = event.employee;
  const [manager] = e.manager_employee_no
    ? await db.select().from(employees).where(eq(employees.employeeNo, e.manager_employee_no))
    : [];
  const [row] = await db
    .insert(employees)
    .values({
      employeeNo: e.employee_no,
      fullName: e.full_name,
      email: e.email,
      gender: e.gender,
      departmentCode: e.department_code,
      location: e.location,
      position: e.position,
      grade: e.grade,
      managerId: manager?.id ?? null,
      hireDate: e.hire_date,
      employmentType: e.employment_type,
      probationMonths: e.probation_months,
      monthlyWage: e.monthly_wage,
    })
    .onConflictDoUpdate({ target: employees.employeeNo, set: { fullName: e.full_name, hireDate: e.hire_date, position: e.position } })
    .returning();
  const id = await startOnboarding(db, { employeeId: row!.id, initiatorId: null, actor: "hris:webhook" });
  return c.json({ instanceId: id }, 202);
});
