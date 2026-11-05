import { describe, expect, it } from "vitest";

import { HOLIDAYS_2026, makeCalendar } from "../src/engine/calendar.js";
import { compensation, monthsOfService, renewalOptions } from "../src/domain/contract.js";
import { annualEntitlement, checkLeave, type LeaveContext } from "../src/domain/leave.js";

const calendar = makeCalendar(HOLIDAYS_2026);
const ctx: LeaveContext = {
  today: "2026-11-05",
  gender: "F",
  hireDate: "2021-03-15",
  annualRemaining: 7,
  existing: [{ start: "2026-12-14", end: "2026-12-15" }],
  calendar,
};

describe("annual entitlement", () => {
  it("is zero before 12 months of service", () => {
    expect(annualEntitlement("2026-03-01", 2026)).toEqual({ days: 0, eligibleFrom: "2027-03-01" });
  });
  it("is pro-rated in the year eligibility starts", () => {
    // Eligible 15 March 2026: whole months left after March are April to December (9).
    expect(annualEntitlement("2025-03-15", 2026)).toEqual({ days: 9, eligibleFrom: "2026-03-15" });
  });
  it("is twelve once a full year has been served before 1 January", () => {
    expect(annualEntitlement("2021-03-15", 2026).days).toBe(12);
  });
  it("handles a 29 February hire date", () => {
    expect(annualEntitlement("2024-02-29", 2025).eligibleFrom).toBe("2025-02-28");
  });
});

describe("checkLeave", () => {
  it("counts working days and the balance left", () => {
    const r = checkLeave({ type: "annual", start: "2026-11-09", end: "2026-11-13" }, ctx);
    expect(r).toMatchObject({ days: 5, errors: [], balanceAfter: 2 });
  });

  it("does not charge the Christmas closure", () => {
    // 21-31 Dec: 24 (cuti bersama) and 25 (holiday) are closed, as are weekends.
    expect(checkLeave({ type: "annual", start: "2026-12-21", end: "2026-12-31" }, { ...ctx, annualRemaining: 12 }).days).toBe(7);
  });

  it("refuses more days than remain", () => {
    const r = checkLeave({ type: "annual", start: "2026-11-09", end: "2026-11-20" }, ctx);
    expect(r.errors).toContain("Only 7 annual leave days remain");
  });

  it("refuses annual leave before eligibility", () => {
    const r = checkLeave({ type: "annual", start: "2026-11-09", end: "2026-11-10" }, { ...ctx, hireDate: "2026-02-02" });
    expect(r.errors.join()).toMatch(/after 12 months' service \(from 2027-02-02\)/);
  });

  it("caps special leave at its statutory length", () => {
    const r = checkLeave({ type: "marriage", start: "2026-11-09", end: "2026-11-12" }, ctx);
    expect(r.errors).toContain("Own marriage is at most 3 working days");
    expect(r.balanceAfter).toBeNull();
  });

  it("counts maternity leave in calendar days", () => {
    const r = checkLeave({ type: "maternity", start: "2026-11-09", end: "2027-02-06" }, { ...ctx, existing: [] });
    expect(r).toMatchObject({ days: 90, unit: "calendar_days", errors: [] });
  });

  it("applies gender limits", () => {
    expect(checkLeave({ type: "maternity", start: "2026-11-09", end: "2026-11-20" }, { ...ctx, gender: "M" }).errors.join()).toMatch(/does not apply/);
    expect(checkLeave({ type: "paternity", start: "2026-11-09", end: "2026-11-10" }, ctx).errors.join()).toMatch(/does not apply/);
  });

  it("warns, but allows, paternity leave beyond two days", () => {
    const r = checkLeave({ type: "paternity", start: "2026-11-09", end: "2026-11-12" }, { ...ctx, gender: "M" });
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatch(/by agreement/);
  });

  it("lets sick leave be backdated but needs the doctor's note", () => {
    const r = checkLeave({ type: "sick", start: "2026-11-02", end: "2026-11-03" }, ctx);
    expect(r.errors).toEqual(["Doctor's note number is required"]);
    expect(checkLeave({ type: "sick", start: "2026-11-02", end: "2026-11-03", reference: "SKD/123" }, ctx).errors).toEqual([]);
    expect(checkLeave({ type: "annual", start: "2026-11-02", end: "2026-11-03" }, ctx).errors).toContain("Annual leave cannot start in the past");
  });

  it("rejects overlaps and empty ranges", () => {
    expect(checkLeave({ type: "annual", start: "2026-12-15", end: "2026-12-16" }, ctx).errors.join()).toMatch(/Overlaps/);
    expect(checkLeave({ type: "annual", start: "2026-11-07", end: "2026-11-08" }, ctx).errors).toContain(
      "There are no working days in that range",
    );
  });
});

describe("PKWT arithmetic", () => {
  it("measures service in months with a fractional last month", () => {
    expect(monthsOfService("2025-12-01", "2026-11-30")).toBe(12);
    expect(monthsOfService("2026-05-01", "2026-10-31")).toBe(6);
    expect(monthsOfService("2026-05-01", "2026-05-16")).toBeCloseTo(0.52, 2);
  });

  it("pays (months / 12) x the monthly wage, and nothing under one month", () => {
    expect(compensation({ start: "2026-05-01", end: "2026-10-31" }, 6_000_000)).toEqual({ months: 6, amount: 3_000_000 });
    expect(compensation({ start: "2025-12-01", end: "2026-11-30" }, 7_200_000).amount).toBe(7_200_000);
    expect(compensation({ start: "2026-10-20", end: "2026-11-10" }, 6_000_000).amount).toBe(0);
  });

  it("offers renewal only while the five-year limit allows another year", () => {
    const fourYears = [
      { start: "2022-12-01", end: "2024-11-30" },
      { start: "2024-12-01", end: "2026-11-30" },
    ];
    expect(renewalOptions(fourYears).allowed).toEqual(["renew", "convert", "end"]);
    const fourAndAHalf = [{ start: "2022-06-01", end: "2026-11-30" }];
    expect(renewalOptions(fourAndAHalf)).toMatchObject({ allowed: ["convert", "end"], remainingMonths: 6 });
  });
});
