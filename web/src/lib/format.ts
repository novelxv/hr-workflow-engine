const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-US");

function parse(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export const fmtDate = (v?: string | null) => (v ? dateFmt.format(parse(v)) : "—");
export const fmtShortDate = (v?: string | null) => (v ? shortDate.format(parse(v)) : "—");
export const fmtDateTime = (v?: string | null) => (v ? dateTimeFmt.format(parse(v)) : "—");
export const fmtRupiah = (v?: number | null) => (v === null || v === undefined ? "—" : rupiah.format(v));
export const fmtNumber = (v?: number | null) => (v === null || v === undefined ? "—" : number.format(v));

/** Working hours as a readable duration (a working day is nine hours, 08:00-17:00). */
export function fmtHours(h?: number | null): string {
  if (h === null || h === undefined) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 9) return `${h.toFixed(1)} h`;
  return `${(h / 9).toFixed(1)} days`;
}

/** "due in 3 h", "overdue by 2 days", in wall-clock terms for the inbox. */
export function dueLabel(due: string, now = new Date()): { text: string; overdue: boolean } {
  const ms = parse(due).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const hours = abs / 3_600_000;
  const span = hours < 1 ? `${Math.max(1, Math.round(abs / 60_000))} min` : hours < 36 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`;
  return ms >= 0 ? { text: `due in ${span}`, overdue: false } : { text: `overdue by ${span}`, overdue: true };
}

export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

export const WORKFLOW_LABEL: Record<string, string> = {
  leave_request: "Leave request",
  onboarding: "Onboarding",
  contract_renewal: "PKWT renewal",
  offboarding: "Offboarding",
};

export const ROLE_LABEL: Record<string, string> = {
  HR_OPS: "HR operations",
  IT_SUPPORT: "IT support",
  GENERAL_AFFAIRS: "General affairs",
  PAYROLL: "Payroll",
  ADMIN: "Admin",
  EMPLOYEE: "Employee",
};

export const STATUS_LABEL: Record<string, string> = {
  running: "In progress",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
  cancelled: "Cancelled",
};
