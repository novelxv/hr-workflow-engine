/**
 * Six months of workflow history, produced by driving the real engine with a simulated
 * clock.
 *
 * Nothing here writes a duration or an SLA outcome directly. The simulator decides *when*
 * people respond (a log-normal delay per kind of assignee, in working hours) and *what*
 * they decide; the engine does the rest: due dates, escalations, joins, waits. Instances
 * still open at the real "now" stay open, so the demo inbox has genuine work in it.
 *
 * One bottleneck is planted on purpose and stated in the README: laptops for branch
 * joiners ship from Jakarta, so that task's response time is longer outside Jakarta.
 * The analytics should find it without being told.
 */
import { contractRenewal, leaveRequest, offboarding, onboarding } from "../definitions/index.js";
import { compensation, renewalOptions } from "../domain/contract.js";
import { annualEntitlement, checkLeave, LEAVE_TYPE } from "../domain/leave.js";
import {
  addDays,
  addWorkingHours,
  isWorkingDay,
  wibDate,
  type WorkCalendar,
} from "../engine/calendar.js";
import { advance, start, type Effect, type EngineEvent, type InstanceState } from "../engine/engine.js";
import type { Definition } from "../engine/schema.js";
import { resolveAssignee, resolveEscalation, type Directory, type Resolved } from "../services/assign.js";
import { render } from "../services/templates.js";
import { pkwtChain, type Rng, type SeedContract, type SeedDirectory, type SeedEmployee } from "./directory.js";

const DEFS: Record<string, Definition> = {
  leave_request: leaveRequest,
  onboarding,
  contract_renewal: contractRenewal,
  offboarding,
};

// Median response in working hours and log-normal spread, by kind of assignee.
export const RESPONSE: Record<string, { median: number; sigma: number }> = {
  manager: { median: 4, sigma: 0.9 },
  head: { median: 12, sigma: 0.8 },
  hrbp: { median: 7, sigma: 0.7 },
  it: { median: 8, sigma: 0.7 },
  laptop_jakarta: { median: 10, sigma: 0.5 },
  laptop_branch: { median: 30, sigma: 0.5 },
  ga: { median: 10, sigma: 0.7 },
  hr_ops: { median: 16, sigma: 0.7 },
  payroll: { median: 12, sigma: 0.6 },
  training: { median: 35, sigma: 0.6 },
  escalated: { median: 3, sigma: 0.6 },
};

const REJECT_RATE: Record<string, number> = {
  manager_approval: 0.06,
  head_approval: 0.1,
  hrbp_review: 0.08,
  probation_review: 0.05,
  manager_ack: 0.04,
};
const REJECT_NOTES = [
  "Quarter-end close; please move it by a week.",
  "Two others from the team are already off those days.",
  "Audit fieldwork that week. Can we talk about other dates?",
  "Please hand over the open claims first.",
];

export interface SimTask {
  id: number;
  instanceId: number;
  taskKey: string;
  stepId: string;
  branchId: string | null;
  kind: string;
  name: string;
  assigneeEmployeeId: number | null;
  assigneeRole: string | null;
  assigneeRule: unknown;
  status: "open" | "completed" | "cancelled";
  outcome: string | null;
  note: string | null;
  checklist: string[] | null;
  options: unknown;
  instructions: string | null;
  slaHours: number;
  createdAt: Date;
  dueAt: Date;
  originalDueAt: Date;
  completedAt: Date | null;
  completedBy: number | null;
  escalationLevel: number;
  escalatedAt: Date | null;
}

export interface SimInstance {
  id: number;
  key: string;
  title: string;
  subjectEmployeeId: number;
  initiatorEmployeeId: number | null;
  state: InstanceState;
  startedAt: Date;
  completedAt: Date | null;
  holdUntilAfterNow: Set<string>;
}

export interface SimEvent {
  instanceId: number;
  at: Date;
  type: string;
  actor: string | null;
  data: Record<string, unknown>;
}

export interface SimNotification {
  employeeId: number;
  at: Date;
  title: string;
  body: string;
  link: string;
}

export interface SimResult {
  instances: SimInstance[];
  tasks: SimTask[];
  events: SimEvent[];
  notifications: SimNotification[];
  balances: Map<number, { entitled: number; carriedOver: number; used: number }>;
  contracts: SeedContract[];
  employees: SeedEmployee[];
  window: { from: Date; to: Date };
}

interface Queued {
  at: number;
  seq: number;
  run: () => void;
}

class Queue {
  private items: Queued[] = [];
  private seq = 0;
  push(at: Date, run: () => void) {
    this.items.push({ at: at.getTime(), seq: this.seq++, run });
    // Small queue (a few thousand entries): keep it sorted by insertion.
    let i = this.items.length - 1;
    while (i > 0 && this.cmp(this.items[i - 1]!, this.items[i]!) > 0) {
      [this.items[i - 1], this.items[i]] = [this.items[i]!, this.items[i - 1]!];
      i--;
    }
  }
  private cmp(a: Queued, b: Queued) {
    return a.at - b.at || a.seq - b.seq;
  }
  pop(): Queued | undefined {
    return this.items.shift();
  }
  peek(): Queued | undefined {
    return this.items[0];
  }
}

export interface SimulationOptions {
  now: Date;
  days: number;
  calendar: WorkCalendar;
  rng: Rng;
  directory: SeedDirectory;
  demo: { employeeId: number; managerId: number; headId: number };
}

export function simulate(opts: SimulationOptions): SimResult {
  const { calendar, rng: r, now } = opts;
  const from = new Date(now.getTime() - opts.days * 86_400_000);
  const today = wibDate(now);
  const people = opts.directory.employees;
  const byId = new Map(people.map((p) => [p.id, p]));
  const deptMap = new Map(opts.directory.departments.map((d) => [d.code, d]));
  const dir: Directory = {
    person: (id) => {
      const p = byId.get(id);
      return p && { id: p.id, fullName: p.fullName, managerId: p.managerId, departmentCode: p.departmentCode, location: p.location, isActive: p.isActive };
    },
    department: (code) => {
      const d = deptMap.get(code);
      return d && { headId: d.headEmployeeId, hrbpId: d.hrbpEmployeeId };
    },
  };

  const queue = new Queue();
  const instances: SimInstance[] = [];
  const tasks: SimTask[] = [];
  const events: SimEvent[] = [];
  const notifications: SimNotification[] = [];
  const contracts = opts.directory.contracts.map((c) => ({ ...c }));
  const leaveTaken = new Map<number, { start: string; end: string }[]>();
  const year = Number(today.slice(0, 4));
  const balances = new Map<number, { entitled: number; carriedOver: number; used: number }>();
  for (const p of people) {
    balances.set(p.id, {
      entitled: annualEntitlement(p.hireDate, year).days,
      carriedOver: r.int(0, 3),
      used: p.id === opts.demo.employeeId ? 2 : r.int(0, 4),
    });
  }
  const planned = new Map<number, { at: number; token: number }>();
  let token = 0;

  const sample = (profile: string) => {
    const p = RESPONSE[profile]!;
    return Math.max(0.25, p.median * Math.exp(p.sigma * r.normal()));
  };

  function profileFor(task: SimTask, inst: SimInstance): string {
    if (task.escalationLevel > 0) return "escalated";
    const subject = byId.get(inst.subjectEmployeeId)!;
    if (task.branchId === "laptop") return subject.location === "Jakarta" ? "laptop_jakarta" : "laptop_branch";
    switch (task.assigneeRole) {
      case "IT_SUPPORT":
        return "it";
      case "GENERAL_AFFAIRS":
        return "ga";
      case "HR_OPS":
        return "hr_ops";
      case "PAYROLL":
        return "payroll";
    }
    const rule = task.assigneeRule as { kind: string };
    if (rule.kind === "subject") return "training";
    if (rule.kind === "department_head") return "head";
    if (rule.kind === "hrbp") return "hrbp";
    return "manager";
  }

  function chooseOutcome(task: SimTask, inst: SimInstance): { outcome: string; note?: string } {
    if (task.kind === "task") return { outcome: "done" };
    if (task.kind === "decision") {
      const allowed = (task.options as { value: string }[]).map((o) => o.value);
      const weights: Record<string, number> = { renew: 0.55, convert: 0.3, end: 0.15 };
      let x = r.next() * allowed.reduce((s, v) => s + (weights[v] ?? 0.1), 0);
      for (const v of allowed) if ((x -= weights[v] ?? 0.1) <= 0) return { outcome: v };
      return { outcome: allowed.at(-1)! };
    }
    const rate = REJECT_RATE[task.branchId ?? task.stepId] ?? 0.05;
    if (inst.key === "leave_request" && r.chance(rate)) return { outcome: "rejected", note: r.pick(REJECT_NOTES) };
    if (inst.key !== "leave_request" && r.chance(rate)) return { outcome: "rejected" };
    return { outcome: "approved" };
  }

  function schedule(task: SimTask, inst: SimInstance, from: Date) {
    const hold = inst.holdUntilAfterNow.has(task.branchId ?? task.stepId);
    const at = hold ? new Date(now.getTime() + 1000 * 3_600_000) : addWorkingHours(from, sample(profileFor(task, inst)), calendar);
    const prev = planned.get(task.id);
    if (prev && prev.at <= at.getTime()) return;
    const t = ++token;
    planned.set(task.id, { at: at.getTime(), token: t });
    queue.push(at, () => {
      if (planned.get(task.id)?.token !== t || task.status !== "open") return;
      const assignee = task.assigneeEmployeeId ?? firstWithRole(task.assigneeRole);
      const { outcome, note } = chooseOutcome(task, inst);
      task.status = "completed";
      task.outcome = outcome;
      task.note = note ?? null;
      task.completedAt = at;
      task.completedBy = assignee;
      events.push({ instanceId: inst.id, at, type: "task_completed", actor: actorLabel(assignee), data: { task: task.name, outcome, note: note ?? null } });
      apply(inst, { type: "complete_task", key: task.taskKey, outcome, by: String(assignee ?? 0), note }, at);
    });
    // Look again when the task falls due, to escalate if it is still open.
    queue.push(task.dueAt, () => tick(inst, task.dueAt));
  }

  const roleHolders = new Map<string, number>();
  function firstWithRole(role: string | null): number | null {
    if (!role) return null;
    if (!roleHolders.has(role)) {
      const title = { IT_SUPPORT: "IT Support Officer", GENERAL_AFFAIRS: "General Affairs Officer", HR_OPS: "HR Operations Officer", PAYROLL: "Payroll Officer" }[role];
      const p = people.find((x) => x.position === title && x.location === "Jakarta") ?? people.find((x) => x.position === title);
      roleHolders.set(role, p?.id ?? 0);
    }
    return roleHolders.get(role) ?? null;
  }
  const actorLabel = (id: number | null) => (id ? byId.get(id)?.email ?? `employee:${id}` : "system");

  function notify(inst: SimInstance, employeeId: number, template: string, at: Date, taskName?: string) {
    const subject = byId.get(inst.subjectEmployeeId)!;
    const msg = render(template, { instanceId: inst.id, instanceTitle: inst.title, subjectName: subject.fullName, context: inst.state.context, taskName });
    notifications.push({ employeeId, at, ...msg });
  }

  function tick(inst: SimInstance, at: Date) {
    if (inst.state.status !== "running") return;
    apply(inst, { type: "tick" }, at);
  }

  function apply(inst: SimInstance, event: EngineEvent, at: Date) {
    const result = advance(DEFS[inst.key]!, inst.state, event, { calendar, now: at });
    inst.state = result.state;
    handle(inst, result.effects, at);
  }

  function handle(inst: SimInstance, effects: Effect[], at: Date) {
    const ctx = { subjectId: inst.subjectEmployeeId, initiatorId: inst.initiatorEmployeeId };
    for (const e of effects) {
      switch (e.type) {
        case "create_task": {
          const who: Resolved = resolveAssignee(e.assignee, ctx, dir);
          const task: SimTask = {
            id: tasks.length + 1,
            instanceId: inst.id,
            taskKey: e.key,
            stepId: e.stepId,
            branchId: e.branchId ?? null,
            kind: e.kind,
            name: e.name,
            assigneeEmployeeId: who.employeeId,
            assigneeRole: who.role,
            assigneeRule: e.assignee,
            status: "open",
            outcome: null,
            note: null,
            checklist: e.checklist ?? null,
            options: e.options ?? null,
            instructions: e.instructions ?? null,
            slaHours: e.slaHours,
            createdAt: at,
            dueAt: new Date(e.dueAt),
            originalDueAt: new Date(e.dueAt),
            completedAt: null,
            completedBy: null,
            escalationLevel: 0,
            escalatedAt: null,
          };
          tasks.push(task);
          if (who.employeeId) notify(inst, who.employeeId, "task_assigned", at, e.name);
          schedule(task, inst, at);
          break;
        }
        case "cancel_task": {
          const t = tasks.find((x) => x.instanceId === inst.id && x.taskKey === e.key);
          if (t && t.status === "open") {
            t.status = "cancelled";
            t.completedAt = at;
          }
          break;
        }
        case "escalate_task": {
          const t = tasks.find((x) => x.instanceId === inst.id && x.taskKey === e.key)!;
          const next = resolveEscalation(e.to, { employeeId: t.assigneeEmployeeId, role: t.assigneeRole }, ctx, dir);
          events.push({
            instanceId: inst.id,
            at,
            type: "escalated",
            actor: "system:scheduler",
            data: {
              task: t.name,
              level: e.level,
              from: t.assigneeEmployeeId ? byId.get(t.assigneeEmployeeId)?.fullName : t.assigneeRole,
              to: next.employeeId ? byId.get(next.employeeId)?.fullName : next.role,
            },
          });
          t.assigneeEmployeeId = next.employeeId;
          t.assigneeRole = next.role;
          t.dueAt = new Date(e.dueAt);
          t.escalationLevel = e.level;
          t.escalatedAt = at;
          if (next.employeeId) notify(inst, next.employeeId, "task_escalated", at, t.name);
          // Held demo tasks stay with whoever holds them now; others get a faster response.
          if (!inst.holdUntilAfterNow.has(t.branchId ?? t.stepId)) schedule(t, inst, at);
          else queue.push(t.dueAt, () => tick(inst, t.dueAt));
          break;
        }
        case "notify": {
          const who = resolveAssignee(e.to, ctx, dir);
          if (who.employeeId) notify(inst, who.employeeId, e.template, at);
          break;
        }
        case "action":
          runAction(inst, e.action, at);
          events.push({ instanceId: inst.id, at, type: "action", actor: "system", data: { action: e.action } });
          break;
        case "step_entered":
          events.push({ instanceId: inst.id, at, type: "step_entered", actor: null, data: { step: e.stepId, stepType: e.stepType } });
          break;
        case "waiting":
          events.push({ instanceId: inst.id, at, type: "waiting", actor: null, data: { step: e.stepId, until: e.until } });
          queue.push(new Date(e.until), () => tick(inst, new Date(e.until)));
          break;
        case "finished":
          inst.completedAt = at;
          events.push({ instanceId: inst.id, at, type: "finished", actor: null, data: { status: e.status, step: e.stepId } });
          afterFinish(inst, at);
          break;
      }
    }
  }

  function runAction(inst: SimInstance, action: string, at: Date) {
    const c = inst.state.context;
    const subject = byId.get(inst.subjectEmployeeId)!;
    if (action === "apply_leave") {
      const type = LEAVE_TYPE.get(String(c.leave_type));
      if (type?.deductsAnnual) balances.get(subject.id)!.used += Number(c.days);
    } else if (action === "record_contract") {
      if (c.decision === "renew") {
        contracts.push({ employeeId: subject.id, kind: "PKWT", startDate: String(c.next_start), endDate: String(c.renewal_end) });
      } else if (c.decision === "convert") {
        contracts.push({ employeeId: subject.id, kind: "PKWTT", startDate: String(c.next_start), endDate: null });
        subject.employmentType = "PKWTT";
      }
    } else if (action === "deactivate_employee") {
      subject.lastDay = String(c.last_day);
      subject.isActive = subject.lastDay >= wibDate(at);
    }
  }

  function afterFinish(inst: SimInstance, at: Date) {
    const c = inst.state.context;
    if (inst.key === "contract_renewal" && c.decision === "end" && String(c.contract_end) >= wibDate(at)) {
      const subject = byId.get(inst.subjectEmployeeId)!;
      const hrbp = deptMap.get(subject.departmentCode)?.hrbpEmployeeId ?? null;
      startOffboarding(subject, String(c.contract_end), at, hrbp, "End of PKWT");
    }
  }

  function begin(key: string, subjectId: number, initiatorId: number | null, title: string, context: Record<string, unknown>, at: Date, hold: string[] = []) {
    const def = DEFS[key]!;
    const inst: SimInstance = {
      id: instances.length + 1,
      key,
      title,
      subjectEmployeeId: subjectId,
      initiatorEmployeeId: initiatorId,
      state: { status: "running", context, cursor: null, open: [], waitUntil: null, visited: [], seq: 0 },
      startedAt: at,
      completedAt: null,
      holdUntilAfterNow: new Set(hold),
    };
    instances.push(inst);
    events.push({ instanceId: inst.id, at, type: "started", actor: actorLabel(initiatorId), data: {} });
    const result = start(def, context, { calendar, now: at });
    inst.state = result.state;
    handle(inst, result.effects, at);
    return inst;
  }

  // --- what starts, and when ----------------------------------------------------------

  const workingInstant = (d: Date) => addWorkingHours(d, r.next() * 8, calendar);
  const randomTime = (lo: Date, hi: Date) => workingInstant(new Date(lo.getTime() + r.next() * (hi.getTime() - lo.getTime())));
  const nthWorkingDay = (fromDay: string, n: number) => {
    let d = fromDay;
    let count = 0;
    while (true) {
      if (isWorkingDay(d, calendar) && ++count >= n) return d;
      d = addDays(d, 1);
    }
  };

  function leaveContext(emp: SeedEmployee, type: string, startDay: string, endDay: string, days: number, unit: string, reference: string | null) {
    const t = LEAVE_TYPE.get(type)!;
    const dept = deptMap.get(emp.departmentCode);
    const bal = balances.get(emp.id)!;
    const remaining = bal.entitled + bal.carriedOver - bal.used;
    return {
      leave_type: type,
      leave_label: t.name,
      paid: t.paid,
      start_date: startDay,
      end_date: endDay,
      days,
      unit,
      reason: null,
      reference,
      balance_before: t.deductsAnnual ? remaining : null,
      balance_after: t.deductsAnnual ? remaining - days : null,
      warnings: [],
      basis: t.basis,
      manager_is_head: dept?.headEmployeeId !== null && dept?.headEmployeeId === emp.managerId,
    };
  }

  function tryLeave(emp: SeedEmployee, at: Date, type: string, startDay: string, length: number, hold: string[] = []) {
    if (instances.some((i) => i.key === "offboarding" && i.subjectEmployeeId === emp.id)) return null;
    const unit = LEAVE_TYPE.get(type)!.unit;
    const endDay = unit === "calendar_days" ? addDays(startDay, length - 1) : nthWorkingDay(startDay, length);
    const reference = type === "sick" ? `SKD/${r.int(1000, 9999)}` : null;
    const bal = balances.get(emp.id)!;
    const pending = instances
      .filter((i) => i.key === "leave_request" && i.subjectEmployeeId === emp.id && i.state.status === "running")
      .reduce((s, i) => s + (LEAVE_TYPE.get(String(i.state.context.leave_type))?.deductsAnnual ? Number(i.state.context.days) : 0), 0);
    const check = checkLeave(
      { type, start: startDay, end: endDay, reference },
      {
        today: wibDate(at),
        gender: emp.gender,
        hireDate: emp.hireDate,
        annualRemaining: bal.entitled + bal.carriedOver - bal.used - pending,
        existing: leaveTaken.get(emp.id) ?? [],
        calendar,
      },
    );
    if (check.errors.length) return null;
    leaveTaken.set(emp.id, [...(leaveTaken.get(emp.id) ?? []), { start: startDay, end: endDay }]);
    const t = LEAVE_TYPE.get(type)!;
    return begin(
      "leave_request",
      emp.id,
      emp.id,
      `${t.name}: ${emp.fullName}, ${startDay} to ${endDay}`,
      leaveContext(emp, type, startDay, endDay, check.days, check.unit, reference),
      at,
      hold,
    );
  }

  function startOffboarding(emp: SeedEmployee, lastDay: string, at: Date, initiator: number | null, reason: string) {
    if (instances.some((i) => i.key === "offboarding" && i.subjectEmployeeId === emp.id)) return;
    const noticeDays = Math.round((Date.parse(lastDay) - Date.parse(wibDate(at))) / 86_400_000);
    begin(
      "offboarding",
      emp.id,
      initiator ?? emp.id,
      `Offboarding: ${emp.fullName}, last day ${lastDay}`,
      { last_day: lastDay, submitted_on: wibDate(at), notice_days: noticeDays, notice_short: noticeDays < 30, reason, employment_type: emp.employmentType },
      at,
    );
  }

  const starts: { at: Date; run: () => void }[] = [];
  const demoEmp = byId.get(opts.demo.employeeId)!;
  const team = people.filter((p) => p.managerId === opts.demo.managerId && p.id !== demoEmp.id);
  const pkwtReport = team.find((p) => p.employmentType === "PKWT");
  const leaveCast = team.filter((p) => p !== pkwtReport);
  const upcoming = people.filter((p) => p.hireDate > today).sort((a, b) => b.hireDate.localeCompare(a.hireDate))[0];
  // People whose current work is staged for the demo keep their recent history quiet.
  const staged = new Set([demoEmp.id, opts.demo.managerId, opts.demo.headId, ...leaveCast.map((p) => p.id)]);
  const excluded = new Set([...staged, pkwtReport?.id, upcoming?.id].filter((x): x is number => x !== undefined));
  const ordinary = people.filter((p) => !excluded.has(p.id) && p.hireDate < today);
  const quietUntil = new Date(now.getTime() - 35 * 86_400_000);

  // Leave: roughly 1.5 annual-leave requests per person over six months, plus sick days and
  // the occasional special leave.
  const annualLengths = [1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 10];
  for (const emp of people.filter((p) => p.hireDate < today)) {
    // The demo employee keeps enough annual leave for a visitor to try a request.
    const n = emp.id === demoEmp.id ? 1 : Math.round(1.5 * (opts.days / 182) + r.normal() * 0.9);
    const until = staged.has(emp.id) ? quietUntil : now;
    for (let k = 0; k < Math.max(0, n); k++) {
      const at = randomTime(from, until);
      const startDay = nthWorkingDay(addDays(wibDate(at), r.int(3, staged.has(emp.id) ? 10 : 30)), 1);
      const length = emp.id === demoEmp.id ? r.int(1, 2) : r.pick(annualLengths);
      starts.push({ at, run: () => tryLeave(emp, at, "annual", startDay, length) });
    }
    if (r.chance(0.3)) {
      const at = randomTime(from, until);
      starts.push({ at, run: () => tryLeave(emp, at, "sick", nthWorkingDay(addDays(wibDate(at), -r.int(1, 3)), 1), r.int(1, 3)) });
    }
    if (r.chance(0.05) && !staged.has(emp.id)) {
      const at = randomTime(from, now);
      const type = r.pick(["marriage", "bereavement_family", "child_ceremony", emp.gender === "M" ? "paternity" : "maternity"]);
      const len = { marriage: 3, bereavement_family: 2, child_ceremony: 2, paternity: r.int(2, 5), maternity: 90 }[type]!;
      const offset = type.startsWith("bereavement") ? -1 : r.int(5, 20);
      starts.push({ at, run: () => tryLeave(emp, at, type, nthWorkingDay(addDays(wibDate(at), offset), 1), len) });
    }
  }

  // Onboarding: new joiners, started ten working days before their first day.
  const fromDay = wibDate(from);
  for (const emp of people.filter((p) => p.hireDate > addDays(fromDay, 14) && p !== upcoming)) {
    let startDay = emp.hireDate;
    for (let k = 0; k < 10; ) {
      startDay = addDays(startDay, -1);
      if (isWorkingDay(startDay, calendar)) k++;
    }
    const at = new Date(`${startDay}T09:00:00+07:00`);
    if (at > now) continue;
    starts.push({
      at,
      run: () => {
        const probationEnd = emp.probationMonths ? addMonthsIso(emp.hireDate, emp.probationMonths) : null;
        begin(
          "onboarding",
          emp.id,
          deptMap.get("HRD")?.hrbpEmployeeId ?? null,
          `Onboarding: ${emp.fullName}, starts ${emp.hireDate}`,
          {
            hire_date: emp.hireDate,
            employment_type: emp.employmentType,
            probation_months: emp.probationMonths,
            probation_end: probationEnd,
            probation_review_date: probationEnd ? addDays(probationEnd, -14) : null,
            position: emp.position,
            location: emp.location,
          },
          at,
        );
      },
    });
  }

  // PKWT renewals: every contract ending inside the window (plus the 45-day lead) gets one.
  const chainUntil = addDays(fromDay, 45);
  for (const emp of people.filter((p) => p.employmentType === "PKWT" && p !== pkwtReport)) {
    const own = contracts.filter((c) => c.employeeId === emp.id);
    const current = own.find((c) => c.endDate && c.endDate >= chainUntil);
    if (!current) continue;
    // Drop the pre-generated contracts after the one that straddles the window start; the
    // simulated decisions decide what comes next.
    for (const c of own) if (c.startDate > current.startDate) contracts.splice(contracts.indexOf(c), 1);
    scheduleRenewal(emp, current);
  }

  function scheduleRenewal(emp: SeedEmployee, current: SeedContract) {
    const startAt = new Date(`${addDays(current.endDate!, -45)}T08:30:00+07:00`);
    if (startAt > now) return;
    starts.push({ at: startAt < from ? from : startAt, run: () => beginRenewal(emp, startAt < from ? from : startAt) });
  }

  function beginRenewal(emp: SeedEmployee, at: Date, hold: string[] = []) {
    const own = contracts.filter((c) => c.employeeId === emp.id).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const current = own.at(-1)!;
    if (current.kind !== "PKWT" || !current.endDate || !emp.isActive) return;
    const options = renewalOptions(own.filter((c) => c.kind === "PKWT").map((c) => ({ start: c.startDate, end: c.endDate! })));
    const comp = compensation({ start: current.startDate, end: current.endDate }, emp.monthlyWage);
    const nextStart = addDays(current.endDate, 1);
    const inst = begin(
      "contract_renewal",
      emp.id,
      null,
      `PKWT renewal: ${emp.fullName}, contract ends ${current.endDate}`,
      {
        contract_start: current.startDate,
        contract_end: current.endDate,
        next_start: nextStart,
        renewal_end: addDays(addMonthsIso(nextStart, 12), -1),
        pkwt_months_used: options.usedMonths,
        pkwt_months_remaining: options.remainingMonths,
        allowed_decisions: options.allowed,
        monthly_wage: emp.monthlyWage,
        compensation_months: comp.months,
        compensation_amount: comp.amount,
        decision: null,
      },
      at,
      hold,
    );
    return inst;
  }

  // Resignations: about fourteen over six months, mostly with 30 days' notice.
  const leavers = ordinary.filter((p) => p.rank <= 4 && p.employmentType === "PKWTT");
  for (let k = 0; k < Math.round(14 * (opts.days / 182)); k++) {
    const emp = r.pick(leavers);
    const at = randomTime(from, now);
    const lastDay = addDays(wibDate(at), r.chance(0.8) ? 30 : 14);
    starts.push({ at, run: () => startOffboarding(emp, lastDay, at, emp.id, "Resignation") });
  }

  // --- the demo accounts' current work --------------------------------------------------
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  // The latest start time whose first deadline has passed but whose second has not, so the
  // task sits with the first escalation target whatever weekday the seed runs on.
  const escalatedOnce = (sla: number) => {
    for (let back = 1; back < 24 * 21; back++) {
      const t = hoursAgo(back);
      const first = addWorkingHours(t, sla, calendar);
      if (first.getTime() < now.getTime() - 3_600_000 && addWorkingHours(first, sla, calendar) > now) return t;
    }
    return hoursAgo(72);
  };
  starts.push({
    at: hoursAgo(20),
    run: () => {
      const days = Math.min(3, remaining(demoEmp));
      if (days > 0) tryLeave(demoEmp, hoursAgo(20), "annual", nthWorkingDay(addDays(today, 12), 1), days, ["manager_approval"]);
    },
  });
  // Pick team members whose real remaining balance covers the request, at the moment the
  // request is made, rather than adjusting anyone's balance.
  const remaining = (emp: SeedEmployee) => {
    const b = balances.get(emp.id)!;
    return b.entitled + b.carriedOver - b.used;
  };
  const usedCast = new Set<number>();
  const castWith = (days: number) => {
    // The smallest balance that still covers it, so larger balances stay for longer requests.
    const pick = leaveCast.filter((p) => !usedCast.has(p.id) && remaining(p) >= days).sort((a, b) => remaining(a) - remaining(b))[0];
    if (pick) usedCast.add(pick.id);
    return pick;
  };
  {
    // Never answered by the manager: escalated once, to the next level up.
    const at = escalatedOnce(16);
    starts.push({
      at,
      run: () => {
        const emp = castWith(2);
        if (emp) tryLeave(emp, at, "annual", nthWorkingDay(addDays(today, 9), 1), 2, ["manager_approval"]);
      },
    });
  }
  starts.push({
    at: hoursAgo(3),
    run: () => {
      const emp = castWith(7);
      if (emp) tryLeave(emp, hoursAgo(3), "annual", nthWorkingDay(addDays(today, 20), 1), 7, ["manager_approval", "head_approval"]);
    },
  });
  if (upcoming) {
    // HR recorded this joiner this morning; the day-one setup is waiting on IT and GA.
    const at = hoursAgo(2);
    starts.push({
      at,
      run: () =>
        begin(
          "onboarding",
          upcoming.id,
          deptMap.get("HRD")?.hrbpEmployeeId ?? null,
          `Onboarding: ${upcoming.fullName}, starts ${upcoming.hireDate}`,
          {
            hire_date: upcoming.hireDate,
            employment_type: upcoming.employmentType,
            probation_months: upcoming.probationMonths,
            probation_end: upcoming.probationMonths ? addMonthsIso(upcoming.hireDate, upcoming.probationMonths) : null,
            probation_review_date: upcoming.probationMonths
              ? addDays(addMonthsIso(upcoming.hireDate, upcoming.probationMonths), -14)
              : null,
            position: upcoming.position,
            location: upcoming.location,
          },
          at,
          ["it_account", "laptop", "access_card", "bpjs_registration", "payroll_setup"],
        ),
    });
  }
  if (pkwtReport) {
    // A contract ending in 43 days whose renewal started two days ago and is with the manager.
    for (const c of contracts.filter((x) => x.employeeId === pkwtReport.id)) contracts.splice(contracts.indexOf(c), 1);
    const end = addDays(today, 43);
    const startDay = addMonthsIso(addDays(end, 1), -12);
    pkwtReport.hireDate = addMonthsIso(startDay, -12);
    balances.get(pkwtReport.id)!.entitled = annualEntitlement(pkwtReport.hireDate, year).days;
    for (const c of pkwtChain(pkwtReport.hireDate, addDays(startDay, -1))) contracts.push({ ...c, employeeId: pkwtReport.id });
    contracts.push({ employeeId: pkwtReport.id, kind: "PKWT", startDate: startDay, endDate: end });
    const at = hoursAgo(44);
    starts.push({ at, run: () => beginRenewal(pkwtReport, at, ["manager_decision"]) });
  }

  // --- run --------------------------------------------------------------------------------
  starts.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const s of starts) queue.push(s.at, s.run);
  while (queue.peek() && queue.peek()!.at <= now.getTime()) queue.pop()!.run();

  for (const p of people) if (p.lastDay && p.lastDay < today) p.isActive = false;
  return { instances, tasks, events, notifications, balances, contracts, employees: people, window: { from, to: now } };
}

function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const yr = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  const last = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
  return `${yr}-${String(mo).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
