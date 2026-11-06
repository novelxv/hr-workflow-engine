"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { SummaryFacts } from "@/components/summary";
import { Badge, Button, Empty, ErrorNote, Field, LinkButton, PageHeader, Panel, Skeleton, Textarea, cx } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { ROLE_LABEL, WORKFLOW_LABEL, dueLabel, fmtDateTime } from "@/lib/format";
import { useMe } from "@/lib/session";
import type { InboxTask } from "@/lib/types";

interface Inbox {
  tasks: InboxTask[];
  completedThisWeek: number;
}

function group(tasks: InboxTask[]) {
  const now = Date.now();
  const day = 24 * 3_600_000;
  return [
    { title: "Overdue", items: tasks.filter((t) => new Date(t.dueAt).getTime() < now) },
    { title: "Due in the next day", items: tasks.filter((t) => { const d = new Date(t.dueAt).getTime(); return d >= now && d < now + day; }) },
    { title: "Later", items: tasks.filter((t) => new Date(t.dueAt).getTime() >= now + day) },
  ].filter((g) => g.items.length);
}

export function InboxView() {
  const { me } = useMe();
  const { data, error, mutate } = useSWR<Inbox>("/inbox", fetcher, { refreshInterval: 60_000 });
  const [selected, setSelected] = useState<number | null>(null);
  const task = data?.tasks.find((t) => t.id === selected) ?? data?.tasks[0];

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Tasks assigned to you, and the shared queues your role works from. Deadlines count working hours (08:00–17:00 WIB, holidays excluded)."
        actions={
          <>
            <LinkButton href="/requests/new/leave">Request leave</LinkButton>
            <LinkButton href="/requests">My requests</LinkButton>
          </>
        }
      />
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {!data ? (
        <Skeleton className="h-72" />
      ) : data.tasks.length === 0 ? (
        <Panel>
          <Empty title="Nothing waiting for you">
            {data.completedThisWeek ? `You closed ${data.completedThisWeek} tasks in the last seven days.` : "New work will appear here."}
          </Empty>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Panel bodyClassName="p-0">
            {group(data.tasks).map((g) => (
              <div key={g.title}>
                <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-[12px] font-medium text-fg-2">
                  {g.title} · {g.items.length}
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((t) => {
                    const due = dueLabel(t.dueAt);
                    return (
                      <li key={t.id}>
                        <button
                          onClick={() => setSelected(t.id)}
                          className={cx("block w-full px-4 py-3 text-left hover:bg-surface-2", task?.id === t.id && "bg-ink-soft/60")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-[13.5px] font-medium text-fg">{t.name}</span>
                            <span className={cx("shrink-0 text-[12px]", due.overdue ? "font-medium text-critical" : "text-fg-3")}>{due.text}</span>
                          </div>
                          <div className="mt-0.5 text-[12.5px] text-fg-2">{t.title}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge tone="outline">{WORKFLOW_LABEL[t.key] ?? t.key}</Badge>
                            {t.queue !== "me" && <Badge tone="ink">{ROLE_LABEL[t.queue] ?? t.queue} queue</Badge>}
                            {t.escalationLevel > 0 && <Badge tone="warning">Escalated to you</Badge>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </Panel>
          {task && <TaskPanel key={task.id} task={task} meId={me?.employeeId} onDone={() => { setSelected(null); mutate(); }} />}
        </div>
      )}
    </>
  );
}

function TaskPanel({ task, meId, onDone }: { task: InboxTask; meId?: number; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<boolean[]>(() => (task.checklist ?? []).map(() => false));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const due = dueLabel(task.dueAt);
  const checklistDone = checked.every(Boolean);
  const ownRequest = task.subjectId === meId && task.kind === "task";

  async function complete(outcome: string) {
    setBusy(outcome);
    setError(null);
    try {
      await api.post(`/tasks/${task.id}/complete`, { outcome, note: note.trim() || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the task");
      setBusy(null);
    }
  }

  return (
    <Panel
      title={task.name}
      description={
        <>
          <Link href={`/requests/${task.instanceId}`} className="text-link hover:underline">
            {task.title}
          </Link>
          {" · "}
          {task.subjectName} ({task.subjectNo}), {task.subjectPosition}, {task.subjectLocation}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-2">
          <span>Raised {fmtDateTime(task.createdAt)} WIB</span>
          <span className={due.overdue ? "font-medium text-critical" : undefined}>
            {due.overdue ? "Overdue" : "Due"} {fmtDateTime(task.dueAt)} WIB
          </span>
          {task.escalationLevel > 0 && <span className="text-warning">Escalated after the original deadline {fmtDateTime(task.originalDueAt)}</span>}
        </div>

        <SummaryFacts workflow={task.key} s={task.summary} />

        {task.instructions && <p className="rounded-md bg-surface-3 px-3 py-2 text-[13px] text-fg-2">{task.instructions}</p>}

        {task.checklist && task.checklist.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-fg-2">Checklist</legend>
            <div className="space-y-1">
              {task.checklist.map((item, i) => (
                <label key={item} className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" className="mt-0.5" checked={checked[i]} onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
                  {item}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {task.kind !== "task" && (
          <Field label={task.kind === "approval" ? "Note (required to reject)" : "Note (optional)"}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        )}
        <ErrorNote>{error}</ErrorNote>

        <div className="flex flex-wrap gap-2">
          {task.kind === "approval" && (
            <>
              <Button variant="primary" disabled={!!busy} onClick={() => complete("approved")}>
                {busy === "approved" ? "Approving…" : "Approve"}
              </Button>
              <Button variant="danger" disabled={!!busy || !note.trim()} onClick={() => complete("rejected")} title={note.trim() ? undefined : "Add a note first"}>
                {busy === "rejected" ? "Rejecting…" : "Reject"}
              </Button>
            </>
          )}
          {task.kind === "decision" &&
            task.options?.map((o) => (
              <Button key={o.value} variant={o.value === "end" ? "danger" : "secondary"} disabled={!!busy} onClick={() => complete(o.value)}>
                {busy === o.value ? "Saving…" : o.label}
              </Button>
            ))}
          {task.kind === "task" && (
            <Button variant="primary" disabled={!!busy || !checklistDone} onClick={() => complete("done")} title={checklistDone ? undefined : "Tick every item first"}>
              {busy ? "Saving…" : ownRequest ? "I have finished" : "Mark done"}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
