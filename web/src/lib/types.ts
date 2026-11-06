export interface Me {
  userId: number;
  employeeId: number;
  email: string;
  roles: string[];
  fullName: string;
  employeeNo: string;
  position: string;
  gender: "F" | "M";
}

export type Summary = Record<string, unknown>;

export interface InboxTask {
  id: number;
  instanceId: number;
  name: string;
  kind: "approval" | "decision" | "task";
  stepId: string;
  branchId: string | null;
  assigneeEmployeeId: number | null;
  assigneeRole: string | null;
  createdAt: string;
  dueAt: string;
  originalDueAt: string;
  escalationLevel: number;
  checklist: string[] | null;
  options: { value: string; label: string }[] | null;
  instructions: string | null;
  status: string;
  key: string;
  title: string;
  subjectId: number;
  subjectName: string;
  subjectNo: string;
  subjectPosition: string;
  subjectLocation: string;
  queue: string;
  overdue: boolean;
  summary: Summary;
}

export interface Notification {
  id: number;
  at: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
}

export interface InstanceRow {
  id: number;
  key: string;
  version: number;
  title: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  subjectName: string;
  subjectNo: string;
  cursor: string | null;
  waitUntil: string | null;
  simulated: boolean;
}

export interface Assignee {
  kind: string;
  role?: string;
  levels?: number;
}

export interface StepDef {
  id: string;
  name: string;
  type: "approval" | "decision" | "task" | "parallel" | "condition" | "wait" | "action" | "notify" | "end";
  assignee?: Assignee;
  slaHours?: number;
  escalateTo?: Assignee;
  next?: string;
  onReject?: string;
  then?: string;
  else?: string;
  when?: unknown;
  branches?: StepDef[];
  options?: { value: string; label: string }[];
  outcome?: string;
  action?: string;
  template?: string;
  to?: Assignee;
  until?: { field: string; offsetDays: number };
  checklist?: string[];
  instructions?: string;
}

export interface DefinitionDoc {
  key: string;
  name: string;
  description: string;
  trigger: { type: string; event?: string; rule?: string };
  steps: StepDef[];
}

export interface InstanceTask {
  id: number;
  name: string;
  stepId: string;
  branchId: string | null;
  kind: string;
  status: "open" | "completed" | "cancelled";
  outcome: string | null;
  note: string | null;
  assignee: string | null;
  completedBy: string | null;
  createdAt: string;
  dueAt: string;
  originalDueAt: string;
  completedAt: string | null;
  escalationLevel: number;
  slaHours: number;
}

export interface InstanceEvent {
  id: number;
  at: string;
  type: string;
  actor: string | null;
  data: Record<string, unknown>;
}

export interface InstanceDetail {
  id: number;
  key: string;
  version: number;
  title: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  simulated: boolean;
  subject: { id: number; name: string; employeeNo: string; position: string; location: string };
  cursor: string | null;
  visited: string[];
  waitUntil: string | null;
  summary: Summary;
  context: Summary;
  definition: DefinitionDoc;
  tasks: InstanceTask[];
  events: InstanceEvent[];
  canCancel: boolean;
}

export interface LeaveType {
  code: string;
  name: string;
  unit: "working_days" | "calendar_days";
  paid: boolean;
  maxDays?: number;
  gender?: "F" | "M";
  needsReference?: string;
  basis: string;
}

export interface Balance {
  year: number;
  entitled: number;
  carriedOver: number;
  used: number;
  pending: number;
  remaining: number;
  eligibleFrom: string;
}

export interface LeavePreview {
  days: number;
  unit: string;
  errors: string[];
  warnings: string[];
  balanceAfter: number | null;
  balance: Balance | null;
}

export interface CatalogEntry {
  key: string;
  name: string;
  version: number;
  versions: number;
  running: number;
  total: number;
  definition: DefinitionDoc;
  publishedAt: string;
}

export interface DefinitionVersion {
  id: number;
  key: string;
  version: number;
  name: string;
  definition: DefinitionDoc;
  publishedAt: string;
  publishedBy: string;
  note: string | null;
}
