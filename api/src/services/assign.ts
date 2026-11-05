/**
 * Turning assignee rules into people.
 *
 * Pure functions over a Directory, so the live runtime and the history simulation resolve
 * "manager of the subject" or "the HRBP" identically. Role-based work (IT, General
 * Affairs, Payroll, HR operations) goes to a shared queue rather than a person.
 */
import type { EscalationTarget } from "../engine/engine.js";
import type { Assignee } from "../engine/schema.js";

export interface Person {
  id: number;
  fullName: string;
  managerId: number | null;
  departmentCode: string;
  location: string;
  isActive: boolean;
}

export interface DepartmentRef {
  headId: number | null;
  hrbpId: number | null;
}

export interface Directory {
  person(id: number): Person | undefined;
  department(code: string): DepartmentRef | undefined;
}

export interface Resolved {
  employeeId: number | null;
  role: string | null;
}

// Who a role queue escalates to: the head of the department that owns the role.
export const ROLE_DEPARTMENT: Record<string, string> = {
  HR_OPS: "HRD",
  PAYROLL: "HRD",
  IT_SUPPORT: "ITD",
  GENERAL_AFFAIRS: "GAF",
};

function activeManager(dir: Directory, id: number | null, levels: number): number | null {
  let cur = id === null ? undefined : dir.person(id);
  for (let i = 0; i < levels && cur; i++) {
    let next = cur.managerId === null ? undefined : dir.person(cur.managerId);
    // Skip over people who have left; their reports are still owed an approver.
    while (next && !next.isActive) next = next.managerId === null ? undefined : dir.person(next.managerId);
    cur = next;
  }
  return cur && cur.id !== id ? cur.id : null;
}

export function resolveAssignee(
  rule: Assignee,
  ctx: { subjectId: number; initiatorId: number | null },
  dir: Directory,
): Resolved {
  const subject = dir.person(ctx.subjectId);
  switch (rule.kind) {
    case "subject":
      return { employeeId: ctx.subjectId, role: null };
    case "initiator":
      return { employeeId: ctx.initiatorId ?? ctx.subjectId, role: null };
    case "role":
      return { employeeId: null, role: rule.role };
    case "manager_of_subject": {
      const m = activeManager(dir, ctx.subjectId, rule.levels);
      if (m !== null) return { employeeId: m, role: null };
      return resolveAssignee({ kind: "department_head" }, ctx, dir);
    }
    case "department_head": {
      const head = subject ? dir.department(subject.departmentCode)?.headId ?? null : null;
      if (head !== null && head !== ctx.subjectId) return { employeeId: head, role: null };
      // The head asking for themselves goes one level up.
      const up = activeManager(dir, ctx.subjectId, 1);
      return up !== null ? { employeeId: up, role: null } : { employeeId: null, role: "HR_OPS" };
    }
    case "hrbp": {
      const hrbp = subject ? dir.department(subject.departmentCode)?.hrbpId ?? null : null;
      if (hrbp !== null && hrbp !== ctx.subjectId) return { employeeId: hrbp, role: null };
      return { employeeId: null, role: "HR_OPS" };
    }
  }
}

export function resolveEscalation(
  target: EscalationTarget,
  current: Resolved,
  ctx: { subjectId: number; initiatorId: number | null },
  dir: Directory,
): Resolved {
  if (target.kind !== "manager_of_assignee") {
    const r = resolveAssignee(target, ctx, dir);
    if (r.employeeId !== current.employeeId || r.role !== current.role) return r;
  }
  if (current.employeeId !== null) {
    const m = activeManager(dir, current.employeeId, 1);
    if (m !== null) return { employeeId: m, role: null };
  }
  if (current.role) {
    const dept = ROLE_DEPARTMENT[current.role];
    const head = dept ? dir.department(dept)?.headId ?? null : null;
    if (head !== null) return { employeeId: head, role: null };
  }
  return current;
}
