import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Directory -------------------------------------------------------------------------
// A lightweight copy of the HRIS employee record: enough to route work. In production
// this would be kept in sync from the HRIS through the inbound employee events.

export const departments = pgTable("departments", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  headEmployeeId: integer("head_employee_id"),
  hrbpEmployeeId: integer("hrbp_employee_id"),
});

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    employeeNo: text("employee_no").notNull().unique(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    gender: text("gender").notNull(),
    departmentCode: text("department_code").notNull().references(() => departments.code),
    location: text("location").notNull(),
    position: text("position").notNull(),
    grade: text("grade").notNull(),
    managerId: integer("manager_id"),
    hireDate: date("hire_date").notNull(),
    employmentType: text("employment_type").notNull(),
    probationMonths: integer("probation_months").notNull().default(0),
    monthlyWage: integer("monthly_wage").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastDay: date("last_day"),
  },
  (t) => [index("employees_manager_idx").on(t.managerId)],
);

export const contracts = pgTable(
  "contracts",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    kind: text("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
  },
  (t) => [index("contracts_employee_idx").on(t.employeeId)],
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
  label: text("label").notNull(),
});

// --- Calendar and leave ---------------------------------------------------------------

export const holidays = pgTable("holidays", {
  date: date("date").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
});

export const leaveBalances = pgTable(
  "leave_balances",
  {
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    year: integer("year").notNull(),
    entitled: integer("entitled").notNull(),
    carriedOver: integer("carried_over").notNull().default(0),
    used: integer("used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.year] })],
);

// --- Workflows -------------------------------------------------------------------------

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: text("published_by").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("workflow_definitions_key_version").on(t.key, t.version)],
);

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: serial("id").primaryKey(),
    definitionId: integer("definition_id").notNull().references(() => workflowDefinitions.id),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    subjectEmployeeId: integer("subject_employee_id").notNull().references(() => employees.id),
    initiatorEmployeeId: integer("initiator_employee_id"),
    status: text("status").notNull(),
    state: jsonb("state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    simulated: boolean("simulated").notNull().default(false),
  },
  (t) => [
    index("instances_subject_idx").on(t.subjectEmployeeId),
    index("instances_status_idx").on(t.status),
    index("instances_key_idx").on(t.key),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    instanceId: integer("instance_id").notNull().references(() => workflowInstances.id),
    taskKey: text("task_key").notNull(),
    stepId: text("step_id").notNull(),
    branchId: text("branch_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    assigneeEmployeeId: integer("assignee_employee_id"),
    assigneeRole: text("assignee_role"),
    assigneeRule: jsonb("assignee_rule").notNull(),
    status: text("status").notNull(),
    outcome: text("outcome"),
    note: text("note"),
    checklist: jsonb("checklist"),
    options: jsonb("options"),
    instructions: text("instructions"),
    slaHours: integer("sla_hours").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    originalDueAt: timestamp("original_due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by"),
    escalationLevel: integer("escalation_level").notNull().default(0),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tasks_instance_key").on(t.instanceId, t.taskKey),
    index("tasks_assignee_idx").on(t.assigneeEmployeeId, t.status),
    index("tasks_role_idx").on(t.assigneeRole, t.status),
  ],
);

export const instanceEvents = pgTable(
  "instance_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    instanceId: integer("instance_id").notNull().references(() => workflowInstances.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    actor: text("actor"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("events_instance_idx").on(t.instanceId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notifications_employee_idx").on(t.employeeId)],
);

// --- Integration -----------------------------------------------------------------------

export const webhooks = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull(),
  format: text("format").notNull().default("json"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outbox = pgTable(
  "outbox",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    webhookId: integer("webhook_id").notNull().references(() => webhooks.id),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    deliverAfter: timestamp("deliver_after", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending_idx").on(t.deliveredAt, t.deliverAfter)],
);
