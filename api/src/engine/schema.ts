/**
 * The workflow definition language.
 *
 * A definition is JSON, versioned in the database and validated here. Steps run in the
 * order listed unless a step names its `next`. Branching is explicit (condition steps),
 * and a running instance keeps the version it started on, so publishing a new version
 * never changes a process already in flight.
 */
import { z } from "zod";

export const ROLES = ["HR_OPS", "IT_SUPPORT", "GENERAL_AFFAIRS", "PAYROLL"] as const;

export const Assignee = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manager_of_subject"), levels: z.number().int().min(1).max(3).default(1) }),
  z.object({ kind: z.literal("department_head") }),
  z.object({ kind: z.literal("hrbp") }),
  z.object({ kind: z.literal("role"), role: z.enum(ROLES) }),
  z.object({ kind: z.literal("subject") }),
  z.object({ kind: z.literal("initiator") }),
]);
export type Assignee = z.infer<typeof Assignee>;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      field: string;
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "truthy";
      value?: unknown;
    };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(Condition).min(1) }),
    z.object({ any: z.array(Condition).min(1) }),
    z.object({ not: Condition }),
    z.object({
      field: z.string().min(1),
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "truthy"]),
      value: z.unknown().optional(),
    }),
  ]),
);

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower_snake_case");
const base = { id, name: z.string().min(1) };
const human = {
  assignee: Assignee,
  slaHours: z.number().positive().max(2000),
  escalateTo: Assignee.optional(),
  instructions: z.string().optional(),
};

export const ApprovalStep = z.object({
  ...base,
  ...human,
  type: z.literal("approval"),
  next: id.optional(),
  onReject: id.optional(),
});
export const DecisionStep = z.object({
  ...base,
  ...human,
  type: z.literal("decision"),
  options: z.array(z.object({ value: id, label: z.string() })).min(2),
  // Context key holding the subset of options allowed for this instance.
  allowedFrom: z.string().optional(),
  storeAs: id,
  next: id.optional(),
});
export const TaskStep = z.object({
  ...base,
  ...human,
  type: z.literal("task"),
  checklist: z.array(z.string()).optional(),
  next: id.optional(),
});
const BranchStep = z.discriminatedUnion("type", [ApprovalStep, TaskStep]);
export const ParallelStep = z.object({
  ...base,
  type: z.literal("parallel"),
  branches: z.array(BranchStep).min(2),
  next: id.optional(),
  onReject: id.optional(),
});
export const ConditionStep = z.object({
  ...base,
  type: z.literal("condition"),
  when: Condition,
  then: id,
  else: id,
});
export const WaitStep = z.object({
  ...base,
  type: z.literal("wait"),
  // Resume on context[field] + offsetDays (a YYYY-MM-DD date), at opening time.
  until: z.object({ field: z.string(), offsetDays: z.number().int() }),
  next: id.optional(),
});
export const ActionStep = z.object({
  ...base,
  type: z.literal("action"),
  action: z.string().min(1),
  next: id.optional(),
});
export const NotifyStep = z.object({
  ...base,
  type: z.literal("notify"),
  to: Assignee,
  template: z.string().min(1),
  next: id.optional(),
});
export const EndStep = z.object({
  ...base,
  type: z.literal("end"),
  outcome: z.enum(["completed", "approved", "rejected", "cancelled"]),
});

export const Step = z.discriminatedUnion("type", [
  ApprovalStep,
  DecisionStep,
  TaskStep,
  ParallelStep,
  ConditionStep,
  WaitStep,
  ActionStep,
  NotifyStep,
  EndStep,
]);
export type Step = z.infer<typeof Step>;
export type HumanStep = z.infer<typeof ApprovalStep> | z.infer<typeof DecisionStep> | z.infer<typeof TaskStep>;

export const Definition = z
  .object({
    key: id,
    name: z.string().min(1),
    description: z.string().default(""),
    trigger: z.discriminatedUnion("type", [
      z.object({ type: z.literal("form") }),
      z.object({ type: z.literal("event"), event: z.string() }),
      z.object({ type: z.literal("schedule"), rule: z.string() }),
    ]),
    steps: z.array(Step).min(1),
  })
  .superRefine((def, ctx) => {
    for (const problem of structuralProblems(def.steps)) {
      ctx.addIssue({ code: "custom", message: problem, path: ["steps"] });
    }
  });
export type Definition = z.infer<typeof Definition>;

/** Reference and reachability checks Zod's shape validation cannot express. */
export function structuralProblems(steps: Step[]): string[] {
  const problems: string[] = [];
  const ids = new Map<string, number>();
  const all: { id: string }[] = [];
  for (const s of steps) {
    all.push(s);
    if (s.type === "parallel") all.push(...s.branches);
  }
  for (const s of all) ids.set(s.id, (ids.get(s.id) ?? 0) + 1);
  for (const [stepId, n] of ids) if (n > 1) problems.push(`Step id "${stepId}" is used ${n} times`);

  const topLevel = new Set(steps.map((s) => s.id));
  const refs = (s: Step): string[] => {
    switch (s.type) {
      case "condition":
        return [s.then, s.else];
      case "end":
        return [];
      case "approval":
      case "parallel":
        return [s.next, s.onReject].filter((x): x is string => !!x);
      default:
        return s.next ? [s.next] : [];
    }
  };
  steps.forEach((s, i) => {
    for (const r of refs(s)) {
      if (!topLevel.has(r)) problems.push(`"${s.id}" points to unknown step "${r}"`);
    }
    const fallsThrough = s.type !== "end" && s.type !== "condition" && !("next" in s && s.next);
    if (fallsThrough && i === steps.length - 1) {
      problems.push(`"${s.id}" is the last step but is not an end step and has no next`);
    }
  });
  if (!steps.some((s) => s.type === "end")) problems.push("A workflow needs at least one end step");

  // Reachability from the first step.
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = steps[0] ? [steps[0].id] : [];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const s = byId.get(cur);
    if (!s) continue;
    const idx = steps.indexOf(s);
    const following = steps[idx + 1]?.id;
    const nexts = refs(s);
    if (s.type !== "end" && s.type !== "condition" && !("next" in s && s.next) && following) {
      nexts.push(following);
    }
    stack.push(...nexts);
  }
  for (const s of steps) if (!seen.has(s.id)) problems.push(`"${s.id}" can never be reached`);
  return problems;
}
