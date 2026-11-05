/**
 * The workflow engine: a pure state machine.
 *
 *   start(definition, context, opts)        -> { state, effects }
 *   advance(definition, state, event, opts) -> { state, effects }
 *
 * The engine never reads a database, a clock or a directory. Time comes in through
 * `opts.now`, people are referred to by assignee rules ("manager of the subject") that
 * the runtime resolves, and everything the outside world must do is returned as an
 * effect. The same code drives live requests, the hourly scheduler and the simulation
 * that produced the demo history.
 */
import { addWorkingHours, type WorkCalendar } from "./calendar.js";
import type { Assignee, Condition, Definition, HumanStep, Step } from "./schema.js";

export type Status = "running" | "completed" | "approved" | "rejected" | "cancelled";
export type TaskKind = "approval" | "decision" | "task";

export interface OpenTask {
  key: string;
  stepId: string;
  branchId?: string;
  kind: TaskKind;
  dueAt: string;
  escalations: number;
}

export interface InstanceState {
  status: Status;
  context: Record<string, unknown>;
  cursor: string | null;
  open: OpenTask[];
  waitUntil: string | null;
  visited: string[];
  seq: number;
}

export type EscalationTarget = Assignee | { kind: "manager_of_assignee" };

export type Effect =
  | {
      type: "create_task";
      key: string;
      stepId: string;
      branchId?: string;
      kind: TaskKind;
      name: string;
      assignee: Assignee;
      slaHours: number;
      dueAt: string;
      checklist?: string[];
      options?: { value: string; label: string }[];
      instructions?: string;
    }
  | { type: "cancel_task"; key: string }
  | { type: "escalate_task"; key: string; to: EscalationTarget; dueAt: string; level: number }
  | { type: "notify"; to: Assignee; template: string; stepId: string }
  | { type: "action"; action: string; stepId: string }
  | { type: "step_entered"; stepId: string; stepType: Step["type"] }
  | { type: "waiting"; stepId: string; until: string }
  | { type: "finished"; status: Exclude<Status, "running">; stepId: string | null };

export type EngineEvent =
  | { type: "complete_task"; key: string; outcome: string; by: string; note?: string }
  | { type: "tick" }
  | { type: "cancel"; by: string; reason?: string };

export interface EngineOptions {
  calendar: WorkCalendar;
  now: Date;
}

export interface Result {
  state: InstanceState;
  effects: Effect[];
}

export class EngineError extends Error {}

const MAX_STEPS_PER_RUN = 200;
const MAX_ESCALATIONS = 2;

export function start(def: Definition, context: Record<string, unknown>, opts: EngineOptions): Result {
  const state: InstanceState = {
    status: "running",
    context: structuredClone(context),
    cursor: null,
    open: [],
    waitUntil: null,
    visited: [],
    seq: 0,
  };
  const effects: Effect[] = [];
  const first = def.steps[0];
  if (!first) throw new EngineError("Definition has no steps");
  runFrom(def, state, first.id, opts, effects);
  return { state, effects };
}

export function advance(def: Definition, prev: InstanceState, event: EngineEvent, opts: EngineOptions): Result {
  const state = structuredClone(prev);
  const effects: Effect[] = [];
  if (state.status !== "running") {
    if (event.type === "tick") return { state, effects };
    throw new EngineError(`Instance is already ${state.status}`);
  }
  switch (event.type) {
    case "complete_task":
      completeTask(def, state, event, opts, effects);
      break;
    case "tick":
      tick(def, state, opts, effects);
      break;
    case "cancel":
      for (const t of state.open) effects.push({ type: "cancel_task", key: t.key });
      finish(state, "cancelled", state.cursor, effects);
      break;
  }
  return { state, effects };
}

// --- internals --------------------------------------------------------------------------

function stepById(def: Definition, id: string): Step {
  const step = def.steps.find((s) => s.id === id);
  if (!step) throw new EngineError(`Unknown step "${id}"`);
  return step;
}

function humanStep(def: Definition, task: OpenTask): HumanStep {
  const step = stepById(def, task.stepId);
  if (step.type === "parallel") {
    const branch = step.branches.find((b) => b.id === task.branchId);
    if (!branch) throw new EngineError(`Unknown branch "${task.branchId}"`);
    return branch;
  }
  if (step.type === "approval" || step.type === "task" || step.type === "decision") return step;
  throw new EngineError(`Step "${step.id}" does not take tasks`);
}

function nextOf(def: Definition, step: Step): string {
  if ("next" in step && step.next) return step.next;
  const idx = def.steps.indexOf(step);
  const following = def.steps[idx + 1];
  if (!following) throw new EngineError(`"${step.id}" has nowhere to go`);
  return following.id;
}

export function readPath(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function evaluate(cond: Condition, ctx: Record<string, unknown>): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluate(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evaluate(c, ctx));
  if ("not" in cond) return !evaluate(cond.not, ctx);
  const v = readPath(ctx, cond.field);
  const target = cond.value as never;
  switch (cond.op) {
    case "eq":
      return v === target;
    case "neq":
      return v !== target;
    case "gt":
      return (v as number) > target;
    case "gte":
      return (v as number) >= target;
    case "lt":
      return (v as number) < target;
    case "lte":
      return (v as number) <= target;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(v);
    case "truthy":
      return Boolean(v);
  }
}

function openHuman(
  step: HumanStep,
  topId: string,
  branchId: string | undefined,
  state: InstanceState,
  opts: EngineOptions,
  effects: Effect[],
): void {
  state.seq += 1;
  const key = `${branchId ?? topId}#${state.seq}`;
  const dueAt = addWorkingHours(opts.now, step.slaHours, opts.calendar).toISOString();
  let options: { value: string; label: string }[] | undefined;
  if (step.type === "decision") {
    const allowed = step.allowedFrom ? readPath(state.context, step.allowedFrom) : undefined;
    options = Array.isArray(allowed) ? step.options.filter((o) => allowed.includes(o.value)) : step.options;
    if (options.length === 0) throw new EngineError(`No options left for decision "${step.id}"`);
  }
  state.open.push({ key, stepId: topId, branchId, kind: step.type, dueAt, escalations: 0 });
  effects.push({
    type: "create_task",
    key,
    stepId: topId,
    branchId,
    kind: step.type,
    name: step.name,
    assignee: step.assignee,
    slaHours: step.slaHours,
    dueAt,
    checklist: step.type === "task" ? step.checklist : undefined,
    options,
    instructions: step.instructions,
  });
}

function finish(state: InstanceState, status: Exclude<Status, "running">, stepId: string | null, effects: Effect[]) {
  state.status = status;
  state.cursor = null;
  state.open = [];
  state.waitUntil = null;
  effects.push({ type: "finished", status, stepId });
}

function waitInstant(step: Extract<Step, { type: "wait" }>, state: InstanceState, opts: EngineOptions): Date {
  const base = readPath(state.context, step.until.field);
  if (typeof base !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(base)) {
    throw new EngineError(`Wait "${step.id}" needs a date in context.${step.until.field}`);
  }
  const day = new Date(`${base}T00:00:00+07:00`);
  day.setUTCDate(day.getUTCDate() + step.until.offsetDays);
  return addWorkingHours(day, 0, opts.calendar); // opening time of that day or the next working day
}

function runFrom(def: Definition, state: InstanceState, stepId: string, opts: EngineOptions, effects: Effect[]) {
  let cur: string | null = stepId;
  for (let guard = 0; cur && guard < MAX_STEPS_PER_RUN; guard++) {
    const step = stepById(def, cur);
    state.visited.push(cur);
    effects.push({ type: "step_entered", stepId: cur, stepType: step.type });
    switch (step.type) {
      case "approval":
      case "task":
      case "decision":
        openHuman(step, step.id, undefined, state, opts, effects);
        state.cursor = step.id;
        return;
      case "parallel":
        for (const b of step.branches) openHuman(b, step.id, b.id, state, opts, effects);
        state.cursor = step.id;
        return;
      case "condition":
        cur = evaluate(step.when, state.context) ? step.then : step.else;
        break;
      case "action":
        effects.push({ type: "action", action: step.action, stepId: step.id });
        cur = nextOf(def, step);
        break;
      case "notify":
        effects.push({ type: "notify", to: step.to, template: step.template, stepId: step.id });
        cur = nextOf(def, step);
        break;
      case "wait": {
        const until = waitInstant(step, state, opts);
        if (until <= opts.now) {
          cur = nextOf(def, step);
          break;
        }
        state.cursor = step.id;
        state.waitUntil = until.toISOString();
        effects.push({ type: "waiting", stepId: step.id, until: state.waitUntil });
        return;
      }
      case "end":
        finish(state, step.outcome, step.id, effects);
        return;
    }
  }
  if (cur) throw new EngineError("Too many steps in one run; the definition probably loops");
}

function completeTask(
  def: Definition,
  state: InstanceState,
  event: Extract<EngineEvent, { type: "complete_task" }>,
  opts: EngineOptions,
  effects: Effect[],
) {
  const task = state.open.find((t) => t.key === event.key);
  if (!task) throw new EngineError("That task is not open");
  const human = humanStep(def, task);
  const step = stepById(def, task.stepId);

  if (human.type === "approval" && !["approved", "rejected"].includes(event.outcome)) {
    throw new EngineError("An approval is either approved or rejected");
  }
  if (human.type === "task" && event.outcome !== "done") throw new EngineError("A task can only be done");
  if (human.type === "decision") {
    const allowed = human.allowedFrom ? readPath(state.context, human.allowedFrom) : undefined;
    const values = (Array.isArray(allowed) ? allowed : human.options.map((o) => o.value)) as string[];
    if (!values.includes(event.outcome)) throw new EngineError(`"${event.outcome}" is not an option here`);
    state.context[human.storeAs] = event.outcome;
  }

  const decisions = (state.context.decisions ?? {}) as Record<string, unknown>;
  decisions[task.branchId ?? task.stepId] = {
    outcome: event.outcome,
    by: event.by,
    note: event.note ?? null,
    at: opts.now.toISOString(),
  };
  state.context.decisions = decisions;
  state.open = state.open.filter((t) => t.key !== event.key);

  if (human.type === "approval" && event.outcome === "rejected") {
    for (const other of state.open) effects.push({ type: "cancel_task", key: other.key });
    state.open = [];
    const target = step.type === "parallel" || step.type === "approval" ? step.onReject : undefined;
    if (target) runFrom(def, state, target, opts, effects);
    else finish(state, "rejected", step.id, effects);
    return;
  }
  if (state.open.some((t) => t.stepId === task.stepId)) return; // parallel branches still open
  runFrom(def, state, nextOf(def, step), opts, effects);
}

function tick(def: Definition, state: InstanceState, opts: EngineOptions, effects: Effect[]) {
  for (const task of state.open) {
    if (new Date(task.dueAt) > opts.now || task.escalations >= MAX_ESCALATIONS) continue;
    const human = humanStep(def, task);
    task.escalations += 1;
    task.dueAt = addWorkingHours(opts.now, human.slaHours, opts.calendar).toISOString();
    // First breach: the step's named escalation target, if it has one. After that, up the
    // line from whoever holds the task now.
    const to: EscalationTarget =
      task.escalations === 1 && human.escalateTo ? human.escalateTo : { kind: "manager_of_assignee" };
    effects.push({ type: "escalate_task", key: task.key, to, dueAt: task.dueAt, level: task.escalations });
  }
  if (state.waitUntil && new Date(state.waitUntil) <= opts.now && state.cursor) {
    const step = stepById(def, state.cursor);
    state.waitUntil = null;
    runFrom(def, state, nextOf(def, step), opts, effects);
  }
}
