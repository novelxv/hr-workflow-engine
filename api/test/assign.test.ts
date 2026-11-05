import { describe, expect, it } from "vitest";

import { resolveAssignee, resolveEscalation, type Directory, type Person } from "../src/services/assign.js";

// Head (1) <- Supervisor (2, left the company) <- Analyst (3); HRBP is 9; IT head is 20.
const people: Person[] = [
  { id: 1, fullName: "Head of Claims", managerId: 50, departmentCode: "CLM", location: "JKT", isActive: true },
  { id: 2, fullName: "Supervisor", managerId: 1, departmentCode: "CLM", location: "JKT", isActive: false },
  { id: 3, fullName: "Analyst", managerId: 2, departmentCode: "CLM", location: "JKT", isActive: true },
  { id: 9, fullName: "HRBP", managerId: 30, departmentCode: "HRD", location: "JKT", isActive: true },
  { id: 20, fullName: "Head of IT", managerId: 50, departmentCode: "ITD", location: "JKT", isActive: true },
  { id: 50, fullName: "Director", managerId: null, departmentCode: "EXE", location: "JKT", isActive: true },
];
const dir: Directory = {
  person: (id) => people.find((p) => p.id === id),
  department: (code) =>
    ({ CLM: { headId: 1, hrbpId: 9 }, ITD: { headId: 20, hrbpId: 9 }, EXE: { headId: 50, hrbpId: null } })[code],
};

describe("resolveAssignee", () => {
  it("skips a manager who has left", () => {
    expect(resolveAssignee({ kind: "manager_of_subject", levels: 1 }, { subjectId: 3, initiatorId: 3 }, dir)).toEqual({
      employeeId: 1,
      role: null,
    });
  });

  it("walks further up for level 2", () => {
    expect(resolveAssignee({ kind: "manager_of_subject", levels: 2 }, { subjectId: 3, initiatorId: 3 }, dir).employeeId).toBe(50);
  });

  it("sends a department head's own request one level up", () => {
    expect(resolveAssignee({ kind: "department_head" }, { subjectId: 1, initiatorId: 1 }, dir).employeeId).toBe(50);
  });

  it("routes roles to a shared queue and falls back to HR when no HRBP is set", () => {
    expect(resolveAssignee({ kind: "role", role: "IT_SUPPORT" }, { subjectId: 3, initiatorId: 3 }, dir)).toEqual({
      employeeId: null,
      role: "IT_SUPPORT",
    });
    expect(resolveAssignee({ kind: "hrbp" }, { subjectId: 50, initiatorId: 50 }, dir)).toEqual({ employeeId: null, role: "HR_OPS" });
  });
});

describe("resolveEscalation", () => {
  const ctx = { subjectId: 3, initiatorId: 3 };

  it("uses the step's named target when it is someone new", () => {
    expect(resolveEscalation({ kind: "hrbp" }, { employeeId: 1, role: null }, ctx, dir)).toEqual({ employeeId: 9, role: null });
  });

  it("moves up the line from the current holder", () => {
    expect(resolveEscalation({ kind: "manager_of_assignee" }, { employeeId: 1, role: null }, ctx, dir).employeeId).toBe(50);
  });

  it("escalates a role queue to the owning department's head", () => {
    expect(resolveEscalation({ kind: "manager_of_assignee" }, { employeeId: null, role: "IT_SUPPORT" }, ctx, dir).employeeId).toBe(20);
  });
});
