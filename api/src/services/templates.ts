/** In-app notification text. Plain sentences; the link takes the reader to the work. */

export interface TemplateInput {
  instanceId: number;
  instanceTitle: string;
  subjectName: string;
  context: Record<string, unknown>;
  taskName?: string;
}

export function render(template: string, i: TemplateInput): { title: string; body: string; link: string } {
  const link = `/requests/${i.instanceId}`;
  const c = i.context;
  switch (template) {
    case "task_assigned":
      return { title: `New task: ${i.taskName}`, body: i.instanceTitle, link: "/" };
    case "task_escalated":
      return {
        title: `Overdue task passed to you: ${i.taskName}`,
        body: `${i.instanceTitle}. The original assignee missed the deadline.`,
        link: "/",
      };
    case "leave_approved":
      return {
        title: "Leave approved",
        body: `${c.leave_label ?? "Leave"} from ${c.start_date} to ${c.end_date} (${c.days} ${c.unit === "calendar_days" ? "calendar" : "working"} days).`,
        link,
      };
    case "leave_rejected":
      return { title: "Leave not approved", body: `${c.leave_label ?? "Leave"} from ${c.start_date} to ${c.end_date}.`, link };
    case "onboarding_welcome":
      return {
        title: "Welcome to Arunika Life",
        body: "Your accounts, laptop and access card are ready. Please finish the compliance training in your first two weeks.",
        link,
      };
    case "probation_passed":
      return { title: "Probation completed", body: "Your employment is confirmed. Congratulations.", link };
    case "contract_outcome":
      return {
        title: "Contract decision",
        body:
          c.decision === "convert"
            ? "Your contract will be converted to a permanent (PKWTT) agreement."
            : `Your PKWT will be renewed until ${c.renewal_end}.`,
        link,
      };
    default:
      return { title: template, body: i.instanceTitle, link };
  }
}
