/**
 * Working-time arithmetic in Western Indonesia Time (UTC+7, no daylight saving).
 *
 * SLAs are measured in working hours: an approval with a 16-hour SLA raised on Friday
 * afternoon is due on Tuesday, not Saturday. Leave is counted in working days, skipping
 * weekends, national holidays and, when the company observes them, cuti bersama.
 */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  kind: "national" | "cuti_bersama";
}

export interface WorkCalendar {
  closed: Set<string>; // dates the office is closed (YYYY-MM-DD)
  startHour: number;
  endHour: number;
}

const WIB_OFFSET_MS = 7 * 3600_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function makeCalendar(
  holidays: Holiday[],
  opts: { observeCutiBersama?: boolean; startHour?: number; endHour?: number } = {},
): WorkCalendar {
  const observe = opts.observeCutiBersama ?? true;
  return {
    closed: new Set(holidays.filter((h) => h.kind === "national" || observe).map((h) => h.date)),
    startHour: opts.startHour ?? 8,
    endHour: opts.endHour ?? 17,
  };
}

/** The calendar date in WIB for an instant. */
export function wibDate(at: Date): string {
  return new Date(at.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function addDays(d: string, days: number): string {
  return new Date(parseDate(d).getTime() + days * DAY).toISOString().slice(0, 10);
}

export function isWorkingDay(d: string, cal: WorkCalendar): boolean {
  const dow = parseDate(d).getUTCDay();
  return dow !== 0 && dow !== 6 && !cal.closed.has(d);
}

/** Working days from start to end inclusive. */
export function countWorkingDays(start: string, end: string, cal: WorkCalendar): number {
  if (end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

/** Calendar days from start to end inclusive. */
export function countCalendarDays(start: string, end: string): number {
  if (end < start) return 0;
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY) + 1;
}

// Work on "local milliseconds": UTC instant shifted by +7h, read with getUTC* methods.
function toLocal(at: Date): number {
  return at.getTime() + WIB_OFFSET_MS;
}
function fromLocal(ms: number): Date {
  return new Date(ms - WIB_OFFSET_MS);
}
function localDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function dayStart(day: string, hour: number): number {
  return parseDate(day).getTime() + hour * HOUR;
}

/** The first working instant at or after `ms` (local). */
function nextOpen(ms: number, cal: WorkCalendar): number {
  let day = localDay(ms);
  for (let guard = 0; guard < 400; guard++) {
    if (isWorkingDay(day, cal)) {
      const open = dayStart(day, cal.startHour);
      const close = dayStart(day, cal.endHour);
      if (ms < open) return open;
      if (ms < close) return ms;
    }
    day = addDays(day, 1);
    ms = dayStart(day, 0);
  }
  throw new Error("No working day within 400 days; check the holiday calendar");
}

/** The instant `hours` working hours after `start`. */
export function addWorkingHours(start: Date, hours: number, cal: WorkCalendar): Date {
  let ms = nextOpen(toLocal(start), cal);
  let remaining = hours * HOUR;
  while (remaining > 0) {
    const close = dayStart(localDay(ms), cal.endHour);
    const available = close - ms;
    if (remaining <= available) return fromLocal(ms + remaining);
    remaining -= available;
    ms = nextOpen(close, cal);
  }
  return fromLocal(ms);
}

/** Working hours elapsed between two instants (0 if b <= a). */
export function workingHoursBetween(a: Date, b: Date, cal: WorkCalendar): number {
  if (b <= a) return 0;
  let ms = toLocal(a);
  const end = toLocal(b);
  let total = 0;
  while (ms < end) {
    ms = nextOpen(ms, cal);
    if (ms >= end) break;
    const close = dayStart(localDay(ms), cal.endHour);
    total += Math.min(close, end) - ms;
    ms = close;
  }
  return total / HOUR;
}

/** Indonesia's 2026 national holidays and cuti bersama, per SKB 3 Menteri
 *  No. 1497/2025, 2/2025 and 5/2025 (signed 19 September 2025). */
export const HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-01", name: "Tahun Baru 2026 Masehi", kind: "national" },
  { date: "2026-01-16", name: "Isra Mikraj Nabi Muhammad SAW", kind: "national" },
  { date: "2026-02-16", name: "Cuti bersama Tahun Baru Imlek", kind: "cuti_bersama" },
  { date: "2026-02-17", name: "Tahun Baru Imlek 2577 Kongzili", kind: "national" },
  { date: "2026-03-18", name: "Cuti bersama Hari Suci Nyepi", kind: "cuti_bersama" },
  { date: "2026-03-19", name: "Hari Suci Nyepi (Tahun Baru Saka 1948)", kind: "national" },
  { date: "2026-03-20", name: "Cuti bersama Idulfitri", kind: "cuti_bersama" },
  { date: "2026-03-21", name: "Idulfitri 1447 H", kind: "national" },
  { date: "2026-03-22", name: "Idulfitri 1447 H", kind: "national" },
  { date: "2026-03-23", name: "Cuti bersama Idulfitri", kind: "cuti_bersama" },
  { date: "2026-03-24", name: "Cuti bersama Idulfitri", kind: "cuti_bersama" },
  { date: "2026-04-03", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2026-04-05", name: "Kebangkitan Yesus Kristus (Paskah)", kind: "national" },
  { date: "2026-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2026-05-14", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2026-05-15", name: "Cuti bersama Kenaikan Yesus Kristus", kind: "cuti_bersama" },
  { date: "2026-05-27", name: "Iduladha 1447 H", kind: "national" },
  { date: "2026-05-28", name: "Cuti bersama Iduladha", kind: "cuti_bersama" },
  { date: "2026-05-31", name: "Hari Raya Waisak 2570 BE", kind: "national" },
  { date: "2026-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  { date: "2026-06-16", name: "1 Muharam Tahun Baru Islam 1448 H", kind: "national" },
  { date: "2026-08-17", name: "Proklamasi Kemerdekaan", kind: "national" },
  { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2026-12-24", name: "Cuti bersama Kelahiran Yesus Kristus", kind: "cuti_bersama" },
  { date: "2026-12-25", name: "Kelahiran Yesus Kristus", kind: "national" },
];
