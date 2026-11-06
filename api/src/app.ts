import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";

import { login, logout, requireUser, type AppEnv } from "./auth.js";
import { db } from "./db/client.js";
import { employees, users } from "./db/schema.js";
import { env } from "./env.js";
import { manage } from "./routes/manage.js";
import { requests } from "./routes/requests.js";
import { work } from "./routes/work.js";
import { RuntimeError } from "./services/runtime.js";

export const app = new Hono<AppEnv>();

app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof RuntimeError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof ZodError) {
    return c.json({ error: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 422);
  }
  console.error(err);
  return c.json({ error: "Something went wrong on our side" }, 500);
});

app.get("/live", (c) => c.json({ status: "ok" }));
app.get("/health", async (c) => {
  await db.select({ id: users.id }).from(users).limit(1);
  return c.json({ status: "ok" });
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const u = await login(c, body.email ?? "", body.password ?? "");
  return c.json({ email: u.email, roles: u.roles });
});
app.post("/auth/logout", (c) => {
  logout(c);
  return c.body(null, 204);
});
app.get("/auth/me", requireUser, async (c) => {
  const user = c.get("user");
  const [e] = await db.select().from(employees).where(eq(employees.id, user.employeeId));
  return c.json({ ...user, fullName: e?.fullName, employeeNo: e?.employeeNo, position: e?.position, gender: e?.gender });
});
app.get("/auth/demo-accounts", async (c) => {
  const rows = await db
    .select({ email: users.email, label: users.label, roles: users.roles, fullName: employees.fullName, position: employees.position })
    .from(users)
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .orderBy(users.id);
  return c.json({ password: env.DEMO_MODE === "1" ? env.DEMO_PASSWORD : null, accounts: rows });
});

// Order matters: `manage` holds the public endpoints (signed HRIS hook, scheduler token)
// and must answer before the routers whose middleware requires a signed-in user.
app.route("/", manage);
app.route("/", work);
app.route("/", requests);
