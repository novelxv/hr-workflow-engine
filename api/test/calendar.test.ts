import { describe, expect, it } from "vitest";

import {
  HOLIDAYS_2026,
  addWorkingHours,
  countCalendarDays,
  countWorkingDays,
  makeCalendar,
  wibDate,
  workingHoursBetween,
} from "../src/engine/calendar.js";

const cal = makeCalendar(HOLIDAYS_2026);
const wib = (s: string) => new Date(`${s}+07:00`);

describe("holiday data", () => {
  it("has the 17 national holidays and 8 cuti bersama days the SKB lists", () => {
    expect(HOLIDAYS_2026.filter((h) => h.kind === "national")).toHaveLength(17);
    expect(HOLIDAYS_2026.filter((h) => h.kind === "cuti_bersama")).toHaveLength(8);
    expect(new Set(HOLIDAYS_2026.map((h) => h.date)).size).toBe(25);
  });
});

describe("countWorkingDays", () => {
  it("skips weekends", () => {
    // Mon 2 Nov – Sun 8 Nov 2026
    expect(countWorkingDays("2026-11-02", "2026-11-08", cal)).toBe(5);
  });

  it("skips national holidays and observed cuti bersama around Idulfitri", () => {
    // 16–27 March 2026: Nyepi, Idulfitri and four cuti bersama days fall inside.
    expect(countWorkingDays("2026-03-16", "2026-03-27", cal)).toBe(5);
    const noCutiBersama = makeCalendar(HOLIDAYS_2026, { observeCutiBersama: false });
    expect(countWorkingDays("2026-03-16", "2026-03-27", noCutiBersama)).toBe(9);
  });

  it("is zero for an inverted range", () => {
    expect(countWorkingDays("2026-11-10", "2026-11-09", cal)).toBe(0);
  });

  it("counts calendar days inclusively", () => {
    expect(countCalendarDays("2026-11-01", "2026-11-30")).toBe(30);
  });
});

describe("addWorkingHours", () => {
  it("stays within the day when there is room", () => {
    expect(addWorkingHours(wib("2026-11-03T09:00:00"), 4, cal)).toEqual(wib("2026-11-03T13:00:00"));
  });

  it("rolls a Friday afternoon over the weekend", () => {
    // 3h left on Friday 6 Nov, then 5h on Monday 9 Nov.
    expect(addWorkingHours(wib("2026-11-06T14:00:00"), 8, cal)).toEqual(wib("2026-11-09T13:00:00"));
  });

  it("starts the clock at opening time when raised after hours", () => {
    expect(addWorkingHours(wib("2026-11-03T21:30:00"), 2, cal)).toEqual(wib("2026-11-04T10:00:00"));
  });

  it("jumps the Christmas closure", () => {
    // Wed 23 Dec 16:00 + 2h: Thu 24 (cuti bersama) and Fri 25 (holiday) are closed.
    expect(addWorkingHours(wib("2026-12-23T16:00:00"), 2, cal)).toEqual(wib("2026-12-28T09:00:00"));
  });
});

describe("workingHoursBetween", () => {
  it("is the inverse of addWorkingHours", () => {
    const start = wib("2026-11-05T15:20:00");
    for (const h of [0.5, 3, 9, 17, 40]) {
      const end = addWorkingHours(start, h, cal);
      expect(workingHoursBetween(start, end, cal)).toBeCloseTo(h, 6);
    }
  });

  it("ignores time outside working hours", () => {
    expect(workingHoursBetween(wib("2026-11-07T10:00:00"), wib("2026-11-08T20:00:00"), cal)).toBe(0);
  });
});

it("reads dates in WIB, not UTC", () => {
  // 01:00 WIB on 4 Nov is 18:00 UTC on 3 Nov.
  expect(wibDate(wib("2026-11-04T01:00:00"))).toBe("2026-11-04");
});
