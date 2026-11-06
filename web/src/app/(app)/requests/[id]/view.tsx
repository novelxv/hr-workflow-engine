"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import { FlowDiagram } from "@/components/flow";
import { SummaryFacts } from "@/components/summary";
import { Badge, Button, ErrorNote, Note, PageHeader, Panel, Skeleton, Table, Td, Th } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { STATUS_LABEL, WORKFLOW_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import type { InstanceDetail, InstanceEvent, InstanceTask } from "@/lib/types";

const TONE: Record<string, "good" | "critical" | "neutral" | "ink"> = {
  running: "ink",
  approved: "good",
  completed: "good",
  rejected: "critical",
  cancelled: "neutral",
};

function slaBadge(t: InstanceTask) {
  if (t.status === "cancelled") return <Badge tone="neutral">Cancelled</Badge>;
  if (t.status === "open") {
    return new Date(t.dueAt) < new Date() ? <Badge tone="critical">Overdue</Badge> : <Badge tone="ink">Open</Badge>;
  }
  const late = new Date(t.completedAt!) > new Date(t.originalDueAt);
  return late ? <Badge tone="warning">Late{t.escalationLevel ? `, escalated ×${t.escalationLevel}` : ""}</Badge> : <Badge tone="good">On time</Badge>;
}

function eventText(e: InstanceEvent, stepNames: Map<string, string>): string | null {
  const d = e.data;
  switch (e.type) {
    case "started":
      return `Started by ${e.actor ?? "the system"}`;
    case "task_completed":
      return `${d.task}: ${d.outcome}${d.note ? ` (“${d.note}”)` : ""}`;
    case "escalated":
      return `${d.task} escalated from ${d.from ?? "—"} to ${d.to ?? "—"}`;
    case "waiting":
      return `Waiting until ${fmtDateTime(String(d.until))} WIB`;
    case "action":
      return `System: ${String(d.action).replaceAll("_", " ")}`;
    case "cancel_requested":
      return `Cancelled by ${e.actor}${d.reason ? `: ${d.reason}` : ""}`;
    case "finished":
      return `Finished: ${d.status}`;
    case "step_entered": {
      const t = String(d.stepType);
      return ["approval", "task", "decision", "parallel"].includes(t) ? `Reached “${stepNames.get(String(d.step)) ?? d.step}”` : null;
    }
    default:
      return e.type;
  }
}

export function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useSWR<InstanceDetail>(`/instances/${id}`, fetcher);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (!data) return <Skeleton className="h-72" />;

  const stepNames = new Map<string, string>();
  for (const s of data.definition.steps) {
    stepNames.set(s.id, s.name);
    for (const b of s.branches ?? []) stepNames.set(b.id, b.name);
  }

  async function cancel() {
    if (!confirm("Cancel this request? Open tasks will be closed.")) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.post(`/instances/${data!.id}/cancel`, {});
      await mutate();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/requests" className="hover:underline">
            Requests
          </Link>
        }
        title={data.title}
        description={
          <>
            {data.subject.name} ({data.subject.employeeNo}), {data.subject.position}, {data.subject.location} ·{" "}
            <Link href={`/workflows/${data.key}`} className="text-link hover:underline">
              {WORKFLOW_LABEL[data.key] ?? data.key} v{data.version}
            </Link>{" "}
            · started {fmtDateTime(data.startedAt)} WIB
            {data.completedAt && ` · finished ${fmtDateTime(data.completedAt)} WIB`}
          </>
        }
        actions={
          <>
            <Badge tone={TONE[data.status] ?? "neutral"} className="text-[13px]">
              {STATUS_LABEL[data.status] ?? data.status}
            </Badge>
            {data.canCancel && (
              <Button variant="danger" disabled={cancelling} onClick={cancel}>
                {cancelling ? "Cancelling…" : "Cancel request"}
              </Button>
            )}
          </>
        }
      />
      {cancelError && (
        <div className="mb-3">
          <ErrorNote>{cancelError}</ErrorNote>
        </div>
      )}
      {data.simulated && (
        <div className="mb-4">
          <Note>Part of the simulated history: the engine produced every step and deadline; response times were randomised.</Note>
        </div>
      )}
      {data.waitUntil && (
        <div className="mb-4">
          <Note>Waiting until {fmtDate(data.waitUntil)}, when the next step opens on the scheduler&apos;s tick.</Note>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Details">
            <SummaryFacts workflow={data.key} s={data.summary} />
          </Panel>
          <Panel title="Tasks" bodyClassName="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>Task</Th>
                  <Th>With</Th>
                  <Th>Due</Th>
                  <Th>SLA</Th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <div className="font-medium">{t.name}</div>
                      {t.outcome && (
                        <div className="text-[12px] text-fg-3">
                          {t.outcome} by {t.completedBy ?? "—"} · {fmtDateTime(t.completedAt)}
                          {t.note && <> · “{t.note}”</>}
                        </div>
                      )}
                    </Td>
                    <Td className="text-fg-2">{t.assignee ?? "—"}</Td>
                    <Td className="tabular whitespace-nowrap text-fg-2">
                      {fmtDateTime(t.originalDueAt)}
                      <div className="text-[11.5px] text-fg-3">{t.slaHours} working h</div>
                    </Td>
                    <Td>{slaBadge(t)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Where it is" description={`The ${WORKFLOW_LABEL[data.key]?.toLowerCase() ?? data.key} definition, version ${data.version}, with this request's path marked.`}>
            <FlowDiagram steps={data.definition.steps} visited={data.visited} cursor={data.cursor} status={data.status} tasks={data.tasks} />
          </Panel>
          <Panel title="Timeline" bodyClassName="p-0">
            <ol className="divide-y divide-line">
              {data.events
                .map((e) => ({ e, text: eventText(e, stepNames) }))
                .filter((x) => x.text)
                .map(({ e, text }) => (
                  <li key={e.id} className="flex gap-3 px-4 py-2 text-[13px]">
                    <span className="tabular w-28 shrink-0 text-[12px] text-fg-3">{fmtDateTime(e.at)}</span>
                    <span className="text-fg">{text}</span>
                  </li>
                ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
