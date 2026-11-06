/** Workflow-specific facts for a task card or a request page. */
import { fmtDate, fmtRupiah } from "@/lib/format";
import type { Summary } from "@/lib/types";
import { Note } from "./ui";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-3 border-b border-line py-1.5 text-[13px] last:border-0">
      <dt className="text-fg-3">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

export function SummaryFacts({ workflow, s }: { workflow: string; s: Summary }) {
  const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : null);
  const str = (k: string) => (s[k] === null || s[k] === undefined ? null : String(s[k]));
  if (workflow === "leave_request") {
    const unit = s.unit === "calendar_days" ? "calendar days" : "working days";
    return (
      <div className="space-y-2">
        <dl>
          <Row label="Type">{str("leave_label")}{s.paid === false ? " (unpaid)" : ""}</Row>
          <Row label="Dates">
            {fmtDate(str("start_date"))} to {fmtDate(str("end_date"))}
          </Row>
          <Row label="Length">
            {n("days")} {unit}
          </Row>
          {n("balance_before") !== null && (
            <Row label="Annual balance">
              {n("balance_before")} → <span className="font-medium">{n("balance_after")}</span> days after this request
            </Row>
          )}
          {str("reference") && <Row label="Reference">{str("reference")}</Row>}
          {str("reason") && <Row label="Reason">{str("reason")}</Row>}
          {str("basis") && <Row label="Basis">{str("basis")}</Row>}
        </dl>
        {Array.isArray(s.warnings) && s.warnings.length > 0 && <Note tone="warning">{(s.warnings as string[]).join(" ")}</Note>}
      </div>
    );
  }
  if (workflow === "contract_renewal") {
    const allowed = (s.allowed_decisions as string[] | undefined) ?? [];
    return (
      <div className="space-y-2">
        <dl>
          <Row label="Current PKWT">
            {fmtDate(str("contract_start"))} to {fmtDate(str("contract_end"))}
          </Row>
          <Row label="PKWT used so far">
            {n("pkwt_months_used")} of 60 months ({n("pkwt_months_remaining")} left)
          </Row>
          {n("compensation_amount") !== null && (
            <Row label="Compensation due">
              {fmtRupiah(n("compensation_amount"))}{" "}
              <span className="text-fg-3">
                ({n("compensation_months")} months ÷ 12 × {fmtRupiah(n("monthly_wage"))})
              </span>
            </Row>
          )}
          <Row label="If renewed">until {fmtDate(str("renewal_end"))}</Row>
          {str("decision") && <Row label="Decision">{str("decision")}</Row>}
        </dl>
        {!allowed.includes("renew") && allowed.length > 0 && (
          <Note tone="warning">
            Another 12-month PKWT would take the total past five years (PP 35/2021 Pasal 8). Convert to PKWTT or let it
            end.
          </Note>
        )}
      </div>
    );
  }
  if (workflow === "onboarding") {
    return (
      <dl>
        <Row label="Starts">{fmtDate(str("hire_date"))}</Row>
        <Row label="Position">{str("position")}</Row>
        <Row label="Office">{str("location")}</Row>
        <Row label="Contract">{str("employment_type")}</Row>
        {str("probation_end") && <Row label="Probation ends">{fmtDate(str("probation_end"))}</Row>}
      </dl>
    );
  }
  if (workflow === "offboarding") {
    return (
      <div className="space-y-2">
        <dl>
          <Row label="Last day">{fmtDate(str("last_day"))}</Row>
          <Row label="Submitted">{fmtDate(str("submitted_on"))}</Row>
          <Row label="Notice">{n("notice_days")} days</Row>
          {str("reason") && <Row label="Reason">{str("reason")}</Row>}
        </dl>
        {s.notice_short === true && <Note tone="warning">Less than the 30 days&apos; notice in company policy.</Note>}
      </div>
    );
  }
  return null;
}
