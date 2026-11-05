/**
 * Rebuild the database: schema, directory, published definitions and six months of
 * simulated history.
 *
 *   npm run seed            # drops every table first
 */
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db, sqlClient } from "../db/client.js";
import * as t from "../db/schema.js";
import { BUILT_IN } from "../definitions/index.js";
import { HOLIDAYS_2026, makeCalendar } from "../engine/calendar.js";
import { env } from "../env.js";
import { buildDirectory, rng } from "./directory.js";
import { simulate } from "./simulate.js";

const DAYS = 182;

async function chunked<T>(rows: T[], size: number, insert: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

async function main() {
  const started = Date.now();
  const now = new Date();
  const today = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

  await db.execute(sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await migrate(db, { migrationsFolder: "./drizzle" });

  const directory = buildDirectory(today);
  const find = (position: string, location = "Jakarta") =>
    directory.employees.find((e) => e.position === position && e.location === location)!;
  const head = find("Head of Claims");
  const manager = find("Claims Supervisor");
  const employee = directory.employees.find(
    (e) => e.managerId === manager.id && e.position === "Claims Analyst" && e.employmentType === "PKWTT",
  )!;
  const hrbp = directory.employees.find((e) => e.id === directory.departments.find((d) => d.code === "CLM")!.hrbpEmployeeId)!;
  const it = find("IT Support Officer");
  const admin = find("HR Operations Officer");

  const calendar = makeCalendar(HOLIDAYS_2026);
  const sim = simulate({
    now,
    days: DAYS,
    calendar,
    rng: rng(20261105),
    directory,
    demo: { employeeId: employee.id, managerId: manager.id, headId: head.id },
  });

  await db.insert(t.departments).values(directory.departments.map((d) => ({ ...d, headEmployeeId: null, hrbpEmployeeId: null })));
  await chunked(sim.employees, 200, (part) =>
    db.insert(t.employees).values(
      part.map((e) => ({
        id: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        email: e.email,
        gender: e.gender,
        departmentCode: e.departmentCode,
        location: e.location,
        position: e.position,
        grade: e.grade,
        managerId: e.managerId,
        hireDate: e.hireDate,
        employmentType: e.employmentType,
        probationMonths: e.probationMonths,
        monthlyWage: e.monthlyWage,
        isActive: e.isActive,
        lastDay: e.lastDay,
      })),
    ),
  );
  for (const d of directory.departments) {
    await db
      .update(t.departments)
      .set({ headEmployeeId: d.headEmployeeId, hrbpEmployeeId: d.hrbpEmployeeId })
      .where(sql`${t.departments.code} = ${d.code}`);
  }
  await chunked(sim.contracts, 300, (part) => db.insert(t.contracts).values(part));
  await db.insert(t.holidays).values(HOLIDAYS_2026);
  const year = Number(today.slice(0, 4));
  await chunked([...sim.balances.entries()], 300, (part) =>
    db.insert(t.leaveBalances).values(part.map(([employeeId, b]) => ({ employeeId, year, ...b }))),
  );

  const hash = await bcrypt.hash(env.DEMO_PASSWORD, 10);
  await db.insert(t.users).values([
    { email: "employee@arunikalife.example", passwordHash: hash, employeeId: employee.id, roles: ["EMPLOYEE"], label: "Employee" },
    { email: "manager@arunikalife.example", passwordHash: hash, employeeId: manager.id, roles: ["EMPLOYEE"], label: "Line manager" },
    { email: "head@arunikalife.example", passwordHash: hash, employeeId: head.id, roles: ["EMPLOYEE"], label: "Department head" },
    { email: "hrbp@arunikalife.example", passwordHash: hash, employeeId: hrbp.id, roles: ["EMPLOYEE", "HR_OPS"], label: "HR business partner" },
    { email: "it@arunikalife.example", passwordHash: hash, employeeId: it.id, roles: ["EMPLOYEE", "IT_SUPPORT"], label: "IT support" },
    {
      email: "admin@arunikalife.example",
      passwordHash: hash,
      employeeId: admin.id,
      roles: ["EMPLOYEE", "ADMIN", "HR_OPS", "PAYROLL", "GENERAL_AFFAIRS"],
      label: "HRIS admin",
    },
  ]);

  const defIds: Record<string, number> = {};
  for (const def of BUILT_IN) {
    const [row] = await db
      .insert(t.workflowDefinitions)
      .values({ key: def.key, version: 1, name: def.name, definition: def, publishedBy: "seed", note: "Initial version", publishedAt: sim.window.from })
      .returning();
    defIds[def.key] = row!.id;
  }

  await chunked(sim.instances, 200, (part) =>
    db.insert(t.workflowInstances).values(
      part.map((i) => ({
        id: i.id,
        definitionId: defIds[i.key]!,
        key: i.key,
        version: 1,
        title: i.title,
        subjectEmployeeId: i.subjectEmployeeId,
        initiatorEmployeeId: i.initiatorEmployeeId,
        status: i.state.status,
        state: i.state,
        startedAt: i.startedAt,
        completedAt: i.state.status === "running" ? null : i.completedAt,
        simulated: true,
      })),
    ),
  );
  await chunked(sim.tasks, 300, (part) => db.insert(t.tasks).values(part.map(({ id: _id, ...task }) => task)));
  await chunked(sim.events, 500, (part) => db.insert(t.instanceEvents).values(part));
  await chunked(sim.notifications, 500, (part) => db.insert(t.notifications).values(part));

  for (const table of ["employees", "workflow_instances", "tasks"]) {
    await db.execute(sql.raw(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT max(id) FROM ${table}))`));
  }

  const open = sim.tasks.filter((x) => x.status === "open").length;
  console.log(
    `Seeded ${sim.employees.length} employees, ${sim.instances.length} instances, ${sim.tasks.length} tasks ` +
      `(${open} open), ${sim.events.length} events over ${DAYS} days in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(`Demo: employee ${employee.fullName}, manager ${manager.fullName}, head ${head.fullName}, HRBP ${hrbp.fullName}`);
  await sqlClient.end();
}

await main();
