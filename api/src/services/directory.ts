import { asc, eq } from "drizzle-orm";

import type { DbOrTx } from "../db/client.js";
import { departments, employees, holidays, workflowDefinitions } from "../db/schema.js";
import { makeCalendar, type WorkCalendar } from "../engine/calendar.js";
import { Definition, type Definition as DefinitionT } from "../engine/schema.js";
import type { Directory, Person } from "./assign.js";

export interface LoadedDirectory extends Directory {
  people: Map<number, Person & { email: string; position: string }>;
}

export async function loadDirectory(db: DbOrTx): Promise<LoadedDirectory> {
  const [rows, depts] = await Promise.all([db.select().from(employees), db.select().from(departments)]);
  const people = new Map(
    rows.map((e) => [
      e.id,
      {
        id: e.id,
        fullName: e.fullName,
        managerId: e.managerId,
        departmentCode: e.departmentCode,
        location: e.location,
        isActive: e.isActive,
        email: e.email,
        position: e.position,
      },
    ]),
  );
  const deptMap = new Map(depts.map((d) => [d.code, { headId: d.headEmployeeId, hrbpId: d.hrbpEmployeeId }]));
  return { people, person: (id) => people.get(id), department: (code) => deptMap.get(code) };
}

export async function loadCalendar(db: DbOrTx): Promise<WorkCalendar> {
  const rows = await db.select().from(holidays);
  return makeCalendar(rows.map((h) => ({ date: h.date, name: h.name, kind: h.kind as "national" | "cuti_bersama" })));
}

export async function latestDefinition(db: DbOrTx, key: string) {
  const rows = await db
    .select()
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.key, key))
    .orderBy(asc(workflowDefinitions.version));
  const row = rows.at(-1);
  if (!row) throw new Error(`No published definition for ${key}`);
  return { row, def: Definition.parse(row.definition) as DefinitionT };
}

export async function definitionById(db: DbOrTx, id: number) {
  const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
  if (!row) throw new Error(`Definition ${id} not found`);
  return { row, def: Definition.parse(row.definition) as DefinitionT };
}
