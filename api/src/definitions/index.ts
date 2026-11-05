/**
 * The four built-in HR workflows. Each is plain data checked by the Definition schema;
 * the seed publishes them as version 1 and admins can publish new versions from the UI.
 *
 * Context fields each workflow expects are computed by the API before it starts an
 * instance (see src/services/requests.ts), so the definitions only route on them.
 */
import { Definition, type Definition as DefinitionT } from "../engine/schema.js";

export const leaveRequest: DefinitionT = Definition.parse({
  key: "leave_request",
  name: "Leave request",
  description:
    "Annual, special (Pasal 93), sick, maternity, paternity and unpaid leave. Working days and balance are checked before the request starts.",
  trigger: { type: "form" },
  steps: [
    {
      id: "manager_approval",
      type: "approval",
      name: "Line manager approval",
      assignee: { kind: "manager_of_subject", levels: 1 },
      slaHours: 16,
      escalateTo: { kind: "manager_of_subject", levels: 2 },
      onReject: "notify_rejected",
      instructions: "Check team cover for the dates before approving.",
    },
    {
      id: "needs_head",
      type: "condition",
      name: "More than five days, or unpaid?",
      when: {
        all: [
          { any: [{ field: "days", op: "gt", value: 5 }, { field: "leave_type", op: "eq", value: "unpaid" }] },
          { not: { field: "manager_is_head", op: "truthy" } },
        ],
      },
      then: "head_approval",
      else: "record_leave",
    },
    {
      id: "head_approval",
      type: "approval",
      name: "Department head approval",
      assignee: { kind: "department_head" },
      slaHours: 24,
      onReject: "notify_rejected",
      next: "record_leave",
    },
    { id: "record_leave", type: "action", name: "Deduct from balance", action: "apply_leave" },
    {
      id: "notify_approved",
      type: "notify",
      name: "Tell the employee",
      to: { kind: "subject" },
      template: "leave_approved",
    },
    { id: "approved", type: "end", name: "Approved", outcome: "approved" },
    {
      id: "notify_rejected",
      type: "notify",
      name: "Tell the employee",
      to: { kind: "subject" },
      template: "leave_rejected",
    },
    { id: "rejected", type: "end", name: "Rejected", outcome: "rejected" },
  ],
});

export const onboarding: DefinitionT = Definition.parse({
  key: "onboarding",
  name: "Onboarding",
  description:
    "Day-one setup in parallel, mandatory compliance training, and a probation review before a PKWTT probation lapses.",
  trigger: { type: "event", event: "employee.hired" },
  steps: [
    {
      id: "provision",
      type: "parallel",
      name: "Day-one setup",
      branches: [
        {
          id: "it_account",
          type: "task",
          name: "Create accounts and system access",
          assignee: { kind: "role", role: "IT_SUPPORT" },
          slaHours: 16,
          checklist: [
            "Email and calendar",
            "HRIS self-service login",
            "Core policy-administration role for the position",
          ],
        },
        {
          id: "laptop",
          type: "task",
          name: "Prepare and hand over a laptop",
          assignee: { kind: "role", role: "IT_SUPPORT" },
          slaHours: 24,
          checklist: ["Standard image", "Disk encryption on", "Asset tag registered to the employee"],
        },
        {
          id: "access_card",
          type: "task",
          name: "Issue access card and desk",
          assignee: { kind: "role", role: "GENERAL_AFFAIRS" },
          slaHours: 16,
        },
        {
          id: "bpjs_registration",
          type: "task",
          name: "Register BPJS Ketenagakerjaan and Kesehatan",
          assignee: { kind: "role", role: "HR_OPS" },
          slaHours: 40,
          checklist: ["BPJS Ketenagakerjaan: JKK, JKM, JHT, JP", "BPJS Kesehatan with dependants"],
        },
        {
          id: "payroll_setup",
          type: "task",
          name: "Set up payroll, NPWP and bank account",
          assignee: { kind: "role", role: "PAYROLL" },
          slaHours: 24,
        },
      ],
    },
    { id: "welcome", type: "notify", name: "Welcome message", to: { kind: "subject" }, template: "onboarding_welcome" },
    {
      id: "compliance_training",
      type: "task",
      name: "Complete mandatory compliance training",
      assignee: { kind: "subject" },
      slaHours: 72,
      escalateTo: { kind: "manager_of_subject", levels: 1 },
      checklist: [
        "Code of conduct",
        "Anti-fraud awareness",
        "Anti-money laundering (APU-PPT) awareness",
        "Information security and personal data protection",
      ],
    },
    {
      id: "has_probation",
      type: "condition",
      name: "PKWTT with probation?",
      when: {
        all: [
          { field: "employment_type", op: "eq", value: "PKWTT" },
          { field: "probation_months", op: "gt", value: 0 },
        ],
      },
      then: "wait_probation",
      else: "onboarded",
    },
    {
      id: "wait_probation",
      type: "wait",
      name: "Wait until two weeks before probation ends",
      until: { field: "probation_review_date", offsetDays: 0 },
    },
    {
      id: "probation_review",
      type: "approval",
      name: "Probation review",
      assignee: { kind: "manager_of_subject", levels: 1 },
      slaHours: 40,
      escalateTo: { kind: "hrbp" },
      onReject: "probation_ended",
      instructions:
        "Probation is at most three months and only for PKWTT (UU 13/2003 Pasal 60). It cannot be extended: confirm, or end employment before it lapses.",
    },
    {
      id: "confirm",
      type: "notify",
      name: "Confirm employment",
      to: { kind: "subject" },
      template: "probation_passed",
      next: "onboarded",
    },
    {
      id: "probation_ended",
      type: "task",
      name: "Process end of employment in probation",
      assignee: { kind: "hrbp" },
      slaHours: 16,
      next: "ended_in_probation",
    },
    { id: "onboarded", type: "end", name: "Onboarded", outcome: "completed" },
    { id: "ended_in_probation", type: "end", name: "Ended in probation", outcome: "completed" },
  ],
});

export const contractRenewal: DefinitionT = Definition.parse({
  key: "contract_renewal",
  name: "PKWT renewal",
  description:
    "Started by the daily scan 45 days before a PKWT ends. Renewal is only offered while the total stays within five years (PP 35/2021 Pasal 8).",
  trigger: { type: "schedule", rule: "Daily: PKWT ending within 45 days with no open renewal" },
  steps: [
    {
      id: "manager_decision",
      type: "decision",
      name: "Decide on the contract",
      assignee: { kind: "manager_of_subject", levels: 1 },
      slaHours: 40,
      escalateTo: { kind: "hrbp" },
      options: [
        { value: "renew", label: "Renew for 12 months" },
        { value: "convert", label: "Convert to PKWTT" },
        { value: "end", label: "Let the contract end" },
      ],
      allowedFrom: "allowed_decisions",
      storeAs: "decision",
      instructions:
        "Renewal is hidden when another 12 months would take the PKWT total past five years. Compensation for the period that ends is shown below.",
    },
    {
      id: "route",
      type: "condition",
      name: "Ending the contract?",
      when: { field: "decision", op: "eq", value: "end" },
      then: "end_notice",
      else: "hrbp_review",
    },
    {
      id: "hrbp_review",
      type: "approval",
      name: "HRBP review",
      assignee: { kind: "hrbp" },
      slaHours: 16,
      onReject: "manager_decision",
      instructions: "Rejecting sends the decision back to the manager.",
    },
    {
      id: "issue_agreement",
      type: "task",
      name: "Issue and sign the new agreement",
      assignee: { kind: "role", role: "HR_OPS" },
      slaHours: 24,
      checklist: ["Signed by both parties before the current PKWT ends", "Signed copy filed in the HRIS"],
    },
    { id: "record_contract", type: "action", name: "Update the contract record", action: "record_contract" },
    {
      id: "renewing",
      type: "condition",
      name: "Renewed?",
      when: { field: "decision", op: "eq", value: "renew" },
      then: "pay_compensation_on_renewal",
      else: "notify_outcome",
    },
    {
      id: "pay_compensation_on_renewal",
      type: "task",
      name: "Pay compensation for the period that ended",
      assignee: { kind: "role", role: "PAYROLL" },
      slaHours: 24,
      instructions:
        "PP 35/2021 Pasal 15–16: compensation is due when a PKWT period ends, before an extension starts.",
    },
    {
      id: "notify_outcome",
      type: "notify",
      name: "Tell the employee",
      to: { kind: "subject" },
      template: "contract_outcome",
      next: "done",
    },
    {
      id: "end_notice",
      type: "task",
      name: "Issue end-of-contract notice",
      assignee: { kind: "hrbp" },
      slaHours: 16,
      checklist: ["Notice letter with the last working day", "Compensation amount stated", "Start offboarding"],
    },
    {
      id: "pay_compensation_on_end",
      type: "task",
      name: "Pay end-of-contract compensation",
      assignee: { kind: "role", role: "PAYROLL" },
      slaHours: 24,
      next: "done",
    },
    { id: "done", type: "end", name: "Done", outcome: "completed" },
  ],
});

export const offboarding: DefinitionT = Definition.parse({
  key: "offboarding",
  name: "Offboarding",
  description: "Resignation through to clearance, final pay and the exit interview.",
  trigger: { type: "form" },
  steps: [
    {
      id: "manager_ack",
      type: "approval",
      name: "Manager acknowledges the resignation",
      assignee: { kind: "manager_of_subject", levels: 1 },
      slaHours: 16,
      onReject: "withdrawn",
      instructions: "Reject only if the employee has withdrawn the resignation.",
    },
    {
      id: "clearance",
      type: "parallel",
      name: "Clearance",
      branches: [
        {
          id: "handover",
          type: "task",
          name: "Knowledge handover",
          assignee: { kind: "manager_of_subject", levels: 1 },
          slaHours: 40,
        },
        {
          id: "asset_return",
          type: "task",
          name: "Collect laptop, access card and other assets",
          assignee: { kind: "role", role: "GENERAL_AFFAIRS" },
          slaHours: 24,
        },
        {
          id: "access_revocation",
          type: "task",
          name: "Revoke system access on the last day",
          assignee: { kind: "role", role: "IT_SUPPORT" },
          slaHours: 16,
        },
        {
          id: "final_pay",
          type: "task",
          name: "Final pay, unused leave and PPh 21",
          assignee: { kind: "role", role: "PAYROLL" },
          slaHours: 40,
          checklist: ["Pro-rated salary", "Unused annual leave (uang penggantian hak)", "PPh 21 for the final period"],
        },
        {
          id: "bpjs_exit",
          type: "task",
          name: "Report the exit to BPJS",
          assignee: { kind: "role", role: "HR_OPS" },
          slaHours: 24,
        },
      ],
    },
    { id: "exit_interview", type: "task", name: "Exit interview", assignee: { kind: "hrbp" }, slaHours: 24 },
    { id: "deactivate", type: "action", name: "Deactivate the employee record", action: "deactivate_employee" },
    { id: "done", type: "end", name: "Completed", outcome: "completed" },
    { id: "withdrawn", type: "end", name: "Withdrawn", outcome: "cancelled" },
  ],
});

export const BUILT_IN: DefinitionT[] = [leaveRequest, onboarding, contractRenewal, offboarding];
