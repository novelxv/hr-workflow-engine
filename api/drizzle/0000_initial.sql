CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"head_employee_id" integer,
	"hrbp_employee_id" integer
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"gender" text NOT NULL,
	"department_code" text NOT NULL,
	"location" text NOT NULL,
	"position" text NOT NULL,
	"grade" text NOT NULL,
	"manager_id" integer,
	"hire_date" date NOT NULL,
	"employment_type" text NOT NULL,
	"probation_months" integer DEFAULT 0 NOT NULL,
	"monthly_wage" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_day" date,
	CONSTRAINT "employees_employee_no_unique" UNIQUE("employee_no")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"actor" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"employee_id" integer NOT NULL,
	"year" integer NOT NULL,
	"entitled" integer NOT NULL,
	"carried_over" integer DEFAULT 0 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "leave_balances_employee_id_year_pk" PRIMARY KEY("employee_id","year")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"webhook_id" integer NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"deliver_after" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"task_key" text NOT NULL,
	"step_id" text NOT NULL,
	"branch_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"assignee_employee_id" integer,
	"assignee_role" text,
	"assignee_rule" jsonb NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"note" text,
	"checklist" jsonb,
	"options" jsonb,
	"instructions" text,
	"sla_hours" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"original_due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" integer,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"employee_id" integer NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"format" text DEFAULT 'json' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"subject_employee_id" integer NOT NULL,
	"initiator_employee_id" integer,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_events" ADD CONSTRAINT "instance_events_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_employee_idx" ON "contracts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "events_instance_idx" ON "instance_events" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "notifications_employee_idx" ON "notifications" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("delivered_at","deliver_after");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_instance_key" ON "tasks" USING btree ("instance_id","task_key");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_employee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_role_idx" ON "tasks" USING btree ("assignee_role","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_key_version" ON "workflow_definitions" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "instances_subject_idx" ON "workflow_instances" USING btree ("subject_employee_id");--> statement-breakpoint
CREATE INDEX "instances_status_idx" ON "workflow_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "instances_key_idx" ON "workflow_instances" USING btree ("key");