/**
 * A workflow drawn as a vertical list of steps, in definition order. On an instance each
 * step is marked done, current, waiting or not reached, from the engine's visited list
 * and the instance's tasks.
 */
import type { Assignee, InstanceTask, StepDef } from "@/lib/types";
import { CheckIcon } from "./icons";
import { cx } from "./ui";

const TYPE_LABEL: Record<StepDef["type"], string> = {
  approval: "Approval",
  decision: "Decision",
  task: "Task",
  parallel: "In parallel",
  condition: "Branch",
  wait: "Wait",
  action: "System action",
  notify: "Notification",
  end: "End",
};

export function assigneeText(a?: Assignee): string {
  if (!a) return "";
  switch (a.kind) {
    case "manager_of_subject":
      return a.levels && a.levels > 1 ? `Manager's manager` : "Line manager";
    case "department_head":
      return "Department head";
    case "hrbp":
      return "HR business partner";
    case "subject":
      return "The employee";
    case "initiator":
      return "Whoever raised it";
    case "role":
      return { HR_OPS: "HR operations queue", IT_SUPPORT: "IT support queue", GENERAL_AFFAIRS: "General affairs queue", PAYROLL: "Payroll queue" }[a.role ?? ""] ?? a.role ?? "";
    default:
      return a.kind;
  }
}

function conditionText(when: unknown): string {
  if (!when || typeof when !== "object") return "";
  const w = when as Record<string, unknown>;
  if (Array.isArray(w.all)) return w.all.map(conditionText).join(" and ");
  if (Array.isArray(w.any)) return `(${w.any.map(conditionText).join(" or ")})`;
  if (w.not) return `not ${conditionText(w.not)}`;
  const ops: Record<string, string> = { eq: "is", neq: "is not", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "in", truthy: "" };
  return `${String(w.field).replaceAll("_", " ")}${ops[String(w.op)] ? ` ${ops[String(w.op)]}` : ""}${w.value !== undefined ? ` ${JSON.stringify(w.value)}` : ""}`;
}

type Mark = "done" | "current" | "waiting" | "skipped" | "neutral";

function markFor(step: StepDef, visited?: string[], cursor?: string | null, status?: string): Mark {
  if (!visited) return "neutral";
  if (cursor === step.id) return step.type === "wait" ? "waiting" : "current";
  if (visited.includes(step.id)) return "done";
  return status === "running" ? "neutral" : "skipped";
}

function Dot({ mark }: { mark: Mark }) {
  return (
    <span
      className={cx(
        "relative z-10 mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
        mark === "done" && "border-ink bg-ink text-white",
        mark === "current" && "border-ink bg-surface ring-4 ring-ink-soft",
        mark === "waiting" && "border-warning bg-warning-soft",
        mark === "skipped" && "border-line bg-surface-3",
        mark === "neutral" && "border-line-strong bg-surface",
      )}
    >
      {mark === "done" && <CheckIcon size={10} strokeWidth={3} />}
    </span>
  );
}

function StepBody({ step, tasks }: { step: StepDef; tasks?: InstanceTask[] }) {
  const own = tasks?.filter((t) => (t.branchId ?? t.stepId) === step.id) ?? [];
  const last = own.at(-1);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13.5px] font-medium text-fg">{step.name}</span>
        <span className="text-[11.5px] uppercase tracking-wide text-fg-3">{TYPE_LABEL[step.type]}</span>
      </div>
      <div className="text-[12.5px] text-fg-2">
        {step.assignee && (
          <>
            {assigneeText(step.assignee)}
            {step.slaHours ? ` · SLA ${step.slaHours} working h` : ""}
            {step.escalateTo ? ` · escalates to ${assigneeText(step.escalateTo).toLowerCase()}` : ""}
          </>
        )}
        {step.type === "condition" && (
          <>
            If {conditionText(step.when)} → <code className="font-mono text-[12px]">{step.then}</code>, else{" "}
            <code className="font-mono text-[12px]">{step.else}</code>
          </>
        )}
        {step.type === "wait" && step.until && `Until ${step.until.field.replaceAll("_", " ")}${step.until.offsetDays ? ` ${step.until.offsetDays > 0 ? "+" : ""}${step.until.offsetDays} days` : ""}`}
        {step.type === "action" && <code className="font-mono text-[12px]">{step.action}</code>}
        {step.type === "notify" && `${assigneeText(step.to)} · ${step.template?.replaceAll("_", " ")}`}
        {step.type === "end" && `Outcome: ${step.outcome}`}
        {step.onReject && ` · on reject → ${step.onReject}`}
      </div>
      {last && (
        <div className="mt-0.5 text-[12px] text-fg-3">
          {last.status === "open"
            ? `Waiting on ${last.assignee}${last.escalationLevel ? ` (escalated ×${last.escalationLevel})` : ""}`
            : last.status === "completed"
              ? `${last.outcome} by ${last.completedBy ?? "—"}`
              : "Cancelled"}
          {last.note ? `: “${last.note}”` : ""}
        </div>
      )}
    </div>
  );
}

export function FlowDiagram({
  steps,
  visited,
  cursor,
  status,
  tasks,
}: {
  steps: StepDef[];
  visited?: string[];
  cursor?: string | null;
  status?: string;
  tasks?: InstanceTask[];
}) {
  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const mark = markFor(step, visited, cursor, status);
        return (
          <li key={step.id} className={cx("relative flex gap-3 pb-4", mark === "skipped" && "opacity-55")}>
            {i < steps.length - 1 && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-line-strong" aria-hidden />}
            <Dot mark={mark} />
            <div className="min-w-0 flex-1">
              <StepBody step={step} tasks={tasks} />
              {step.type === "parallel" && step.branches && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {step.branches.map((b) => {
                    const t = tasks?.filter((x) => x.branchId === b.id).at(-1);
                    const bMark: Mark = !visited ? "neutral" : t?.status === "completed" ? "done" : t?.status === "open" ? "current" : mark === "skipped" ? "skipped" : "neutral";
                    return (
                      <div key={b.id} className="flex gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-2">
                        <Dot mark={bMark} />
                        <StepBody step={b} tasks={tasks} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
