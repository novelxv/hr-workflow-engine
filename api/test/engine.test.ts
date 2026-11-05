import { describe, expect, it } from "vitest";

import { BUILT_IN, contractRenewal, leaveRequest, offboarding, onboarding } from "../src/definitions/index.js";
import { HOLIDAYS_2026, makeCalendar } from "../src/engine/calendar.js";
import {
  advance,
  EngineError,
  evaluate,
  start,
  type Effect,
  type EngineOptions,
  type InstanceState,
} from "../src/engine/engine.js";
import { Definition, type Condition } from "../src/engine/schema.js";

const calendar = makeCalendar(HOLIDAYS_2026);
const at = (s: string): EngineOptions => ({ calendar, now: new Date(`${s}+07:00`) });
const created = (fx: Effect[]) => fx.filter((e) => e.type === "create_task");
const only = (state: InstanceState) => {
  expect(state.open).toHaveLength(1);
  return state.open[0]!;
};

describe("built-in definitions", () => {
  it("all pass schema and structural validation", () => {
    for (const def of BUILT_IN) expect(() => Definition.parse(def)).not.toThrow();
  });
});

describe("leave request", () => {
  const ctx = { leave_type: "annual", days: 3, manager_is_head: false };

  it("goes to the line manager, then records and ends approved", () => {
    let r = start(leaveRequest, ctx, at("2026-11-02T09:00:00"));
    const task = only(r.state);
    expect(created(r.effects)[0]).toMatchObject({ kind: "approval", assignee: { kind: "manager_of_subject" } });
    // 16 working hours from Monday 09:00: 8 on Monday, then 8 of Tuesday's 9 (08:00-17:00).
    expect(new Date(task.dueAt)).toEqual(new Date("2026-11-03T16:00:00+07:00"));

    r = advance(leaveRequest, r.state, { type: "complete_task", key: task.key, outcome: "approved", by: "u1" }, at("2026-11-02T11:00:00"));
    expect(r.state.status).toBe("approved");
    expect(r.effects.map((e) => e.type)).toEqual(["step_entered", "step_entered", "action", "step_entered", "notify", "step_entered", "finished"]);
    expect(r.effects.find((e) => e.type === "action")).toMatchObject({ action: "apply_leave" });
  });

  it("adds the department head for more than five days", () => {
    let r = start(leaveRequest, { ...ctx, days: 8 }, at("2026-11-02T09:00:00"));
    r = advance(leaveRequest, r.state, { type: "complete_task", key: only(r.state).key, outcome: "approved", by: "m" }, at("2026-11-02T10:00:00"));
    expect(created(r.effects)[0]).toMatchObject({ stepId: "head_approval", assignee: { kind: "department_head" } });
    expect(r.state.status).toBe("running");
  });

  it("does not ask the same person twice when the manager is the department head", () => {
    let r = start(leaveRequest, { ...ctx, days: 8, manager_is_head: true }, at("2026-11-02T09:00:00"));
    r = advance(leaveRequest, r.state, { type: "complete_task", key: only(r.state).key, outcome: "approved", by: "m" }, at("2026-11-02T10:00:00"));
    expect(r.state.status).toBe("approved");
  });

  it("notifies and ends rejected when the manager rejects", () => {
    let r = start(leaveRequest, ctx, at("2026-11-02T09:00:00"));
    r = advance(leaveRequest, r.state, { type: "complete_task", key: only(r.state).key, outcome: "rejected", by: "m", note: "Quarter-end close" }, at("2026-11-02T10:00:00"));
    expect(r.state.status).toBe("rejected");
    expect(r.effects.some((e) => e.type === "notify" && e.template === "leave_rejected")).toBe(true);
    expect((r.state.context.decisions as Record<string, { note: string }>).manager_approval!.note).toBe("Quarter-end close");
  });

  it("rejects an outcome that does not fit the step", () => {
    const r = start(leaveRequest, ctx, at("2026-11-02T09:00:00"));
    expect(() =>
      advance(leaveRequest, r.state, { type: "complete_task", key: only(r.state).key, outcome: "done", by: "m" }, at("2026-11-02T10:00:00")),
    ).toThrow(EngineError);
  });

  it("does not mutate the previous state", () => {
    const r = start(leaveRequest, ctx, at("2026-11-02T09:00:00"));
    const before = structuredClone(r.state);
    advance(leaveRequest, r.state, { type: "complete_task", key: only(r.state).key, outcome: "approved", by: "m" }, at("2026-11-02T10:00:00"));
    expect(r.state).toEqual(before);
  });
});

describe("SLA escalation", () => {
  it("escalates on the first breach to the step's target, then up the line", () => {
    // Raised Friday 6 Nov 15:00 with a 16h SLA: 2h Friday, 9h Monday, 5h Tuesday -> 13:00.
    let r = start(leaveRequest, { leave_type: "annual", days: 2 }, at("2026-11-06T15:00:00"));
    const task = only(r.state);
    expect(new Date(task.dueAt)).toEqual(new Date("2026-11-10T13:00:00+07:00"));

    r = advance(leaveRequest, r.state, { type: "tick" }, at("2026-11-10T12:59:00"));
    expect(r.effects).toHaveLength(0);

    r = advance(leaveRequest, r.state, { type: "tick" }, at("2026-11-10T13:05:00"));
    expect(r.effects).toEqual([
      expect.objectContaining({ type: "escalate_task", to: { kind: "manager_of_subject", levels: 2 }, level: 1 }),
    ]);

    r = advance(leaveRequest, r.state, { type: "tick" }, at("2026-11-13T09:00:00"));
    expect(r.effects[0]).toMatchObject({ type: "escalate_task", to: { kind: "manager_of_assignee" }, level: 2 });

    r = advance(leaveRequest, r.state, { type: "tick" }, at("2026-11-30T09:00:00"));
    expect(r.effects).toHaveLength(0); // capped at two escalations
  });
});

describe("parallel steps", () => {
  const ctx = { employment_type: "PKWT", probation_months: 0, hire_date: "2026-11-09" };

  it("waits for every branch before moving on", () => {
    let r = start(onboarding, ctx, at("2026-11-02T09:00:00"));
    expect(created(r.effects).map((e) => e.type === "create_task" && e.branchId)).toEqual([
      "it_account",
      "laptop",
      "access_card",
      "bpjs_registration",
      "payroll_setup",
    ]);
    const keys = r.state.open.map((t) => t.key);
    for (const key of keys.slice(0, -1)) {
      r = advance(onboarding, r.state, { type: "complete_task", key, outcome: "done", by: "x" }, at("2026-11-03T09:00:00"));
      expect(created(r.effects)).toHaveLength(0);
    }
    r = advance(onboarding, r.state, { type: "complete_task", key: keys.at(-1)!, outcome: "done", by: "x" }, at("2026-11-03T10:00:00"));
    expect(created(r.effects)[0]).toMatchObject({ stepId: "compliance_training", assignee: { kind: "subject" } });
  });

  it("a rejected approval branch cancels the others", () => {
    let r = start(offboarding, { last_day: "2026-12-04" }, at("2026-11-02T09:00:00"));
    r = advance(offboarding, r.state, { type: "complete_task", key: only(r.state).key, outcome: "approved", by: "m" }, at("2026-11-02T10:00:00"));
    expect(r.state.open).toHaveLength(5);
    const def = Definition.parse({
      key: "p",
      name: "p",
      trigger: { type: "form" },
      steps: [
        {
          id: "both",
          type: "parallel",
          name: "Both",
          branches: [
            { id: "a", type: "approval", name: "A", assignee: { kind: "hrbp" }, slaHours: 8 },
            { id: "b", type: "task", name: "B", assignee: { kind: "hrbp" }, slaHours: 8 },
          ],
        },
        { id: "ok", type: "end", name: "OK", outcome: "approved" },
      ],
    });
    let p = start(def, {}, at("2026-11-02T09:00:00"));
    const a = p.state.open.find((t) => t.branchId === "a")!;
    p = advance(def, p.state, { type: "complete_task", key: a.key, outcome: "rejected", by: "h" }, at("2026-11-02T10:00:00"));
    expect(p.state.status).toBe("rejected");
    expect(p.effects.filter((e) => e.type === "cancel_task")).toHaveLength(1);
  });
});

describe("waits", () => {
  it("parks until the probation review date, then opens the review", () => {
    const ctx = { employment_type: "PKWTT", probation_months: 3, probation_review_date: "2027-01-25" };
    let r = start(onboarding, ctx, at("2026-11-02T09:00:00"));
    for (const t of [...r.state.open]) {
      r = advance(onboarding, r.state, { type: "complete_task", key: t.key, outcome: "done", by: "x" }, at("2026-11-03T09:00:00"));
    }
    r = advance(onboarding, r.state, { type: "complete_task", key: only(r.state).key, outcome: "done", by: "new" }, at("2026-11-10T09:00:00"));
    expect(r.state.cursor).toBe("wait_probation");
    expect(new Date(r.state.waitUntil!)).toEqual(new Date("2027-01-25T08:00:00+07:00"));

    r = advance(onboarding, r.state, { type: "tick" }, at("2027-01-22T09:00:00"));
    expect(r.state.cursor).toBe("wait_probation");
    r = advance(onboarding, r.state, { type: "tick" }, at("2027-01-25T08:30:00"));
    expect(created(r.effects)[0]).toMatchObject({ stepId: "probation_review" });
  });
});

describe("decisions", () => {
  const base = { allowed_decisions: ["convert", "end"], decision: null };

  it("offers only the allowed options and stores the choice", () => {
    let r = start(contractRenewal, base, at("2026-11-02T09:00:00"));
    const create = created(r.effects)[0];
    expect(create && create.type === "create_task" && create.options?.map((o) => o.value)).toEqual(["convert", "end"]);
    expect(() =>
      advance(contractRenewal, r.state, { type: "complete_task", key: only(r.state).key, outcome: "renew", by: "m" }, at("2026-11-02T10:00:00")),
    ).toThrow(/not an option/);
    r = advance(contractRenewal, r.state, { type: "complete_task", key: only(r.state).key, outcome: "end", by: "m" }, at("2026-11-02T10:00:00"));
    expect(r.state.context.decision).toBe("end");
    expect(created(r.effects)[0]).toMatchObject({ stepId: "end_notice" });
  });

  it("an HRBP rejection sends the decision back to the manager", () => {
    let r = start(contractRenewal, { allowed_decisions: ["renew", "convert", "end"] }, at("2026-11-02T09:00:00"));
    r = advance(contractRenewal, r.state, { type: "complete_task", key: only(r.state).key, outcome: "renew", by: "m" }, at("2026-11-02T10:00:00"));
    r = advance(contractRenewal, r.state, { type: "complete_task", key: only(r.state).key, outcome: "rejected", by: "h" }, at("2026-11-02T11:00:00"));
    expect(r.state.status).toBe("running");
    expect(created(r.effects)[0]).toMatchObject({ stepId: "manager_decision" });
  });
});

it("cancelling closes every open task", () => {
  let r = start(onboarding, { employment_type: "PKWT" }, at("2026-11-02T09:00:00"));
  r = advance(onboarding, r.state, { type: "cancel", by: "hr" }, at("2026-11-02T10:00:00"));
  expect(r.state.status).toBe("cancelled");
  expect(r.effects.filter((e) => e.type === "cancel_task")).toHaveLength(5);
  expect(() => advance(onboarding, r.state, { type: "cancel", by: "hr" }, at("2026-11-02T11:00:00"))).toThrow(/already cancelled/);
});

describe("definition validation", () => {
  const steps = (s: unknown[]) => ({ key: "x", name: "x", trigger: { type: "form" }, steps: s });

  it("rejects unknown references, duplicates and unreachable steps", () => {
    const bad = steps([
      { id: "a", type: "approval", name: "A", assignee: { kind: "hrbp" }, slaHours: 8, next: "missing" },
      { id: "a", type: "end", name: "A again", outcome: "approved" },
      { id: "orphan", type: "end", name: "Orphan", outcome: "rejected" },
    ]);
    const result = Definition.safeParse(bad);
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/unknown step "missing"/);
    expect(messages).toMatch(/used 2 times/);
    expect(messages).toMatch(/"orphan" can never be reached/);
  });

  it("requires the last step to end the workflow", () => {
    const r = Definition.safeParse(steps([{ id: "a", type: "task", name: "A", assignee: { kind: "hrbp" }, slaHours: 8 }]));
    expect(r.success).toBe(false);
  });
});

it("evaluates nested conditions", () => {
  const cond: Condition = {
    all: [
      { any: [{ field: "days", op: "gt", value: 5 }, { field: "t", op: "eq", value: "unpaid" }] },
      { not: { field: "x.y", op: "truthy" } },
    ],
  };
  expect(evaluate(cond, { days: 6 })).toBe(true);
  expect(evaluate(cond, { days: 2, t: "unpaid" })).toBe(true);
  expect(evaluate(cond, { days: 6, x: { y: true } })).toBe(false);
  expect(evaluate(cond, { days: 2 })).toBe(false);
});
