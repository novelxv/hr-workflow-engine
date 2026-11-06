"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";

import { Badge, Button, Empty, ErrorNote, Field, Input, Note, PageHeader, Panel, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";

interface Holiday {
  date: string;
  name: string;
  kind: "national" | "cuti_bersama";
}
interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  format: string;
  active: boolean;
  secretHint: string;
}
interface Delivery {
  id: number;
  createdAt: string;
  event: string;
  webhook: string;
  attempts: number;
  deliveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

const EVENTS = ["task.created", "task.escalated", "instance.approved", "instance.rejected", "instance.completed", "instance.cancelled"];

export default function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" description="Calendar, integrations and the scheduler." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Scheduler />
        <Holidays />
      </div>
      <div className="mt-4 space-y-4">
        <Webhooks />
        <Deliveries />
      </div>
    </>
  );
}

function Scheduler() {
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function tick() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<Record<string, number>>("/admin/tick"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tick failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Scheduler" description="Runs hourly in working hours from a GitHub Actions cron. Running it here does the same thing now.">
      <div className="space-y-3 text-[13px] text-fg-2">
        <ul className="list-disc space-y-1 pl-4">
          <li>Escalates tasks past their deadline (at most twice)</li>
          <li>Opens steps whose wait has ended, such as probation reviews</li>
          <li>Starts a renewal for every PKWT ending within 45 days</li>
          <li>Marks people inactive after their last day, and delivers queued webhooks</li>
        </ul>
        <Button variant="primary" disabled={busy} onClick={tick}>
          {busy ? "Running…" : "Run the tick now"}
        </Button>
        <ErrorNote>{error}</ErrorNote>
        {result && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-surface-3 px-3 py-2 text-[12.5px]">
            {Object.entries(result).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                <span className="tabular font-medium text-fg">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Holidays() {
  const { data, mutate } = useSWR<Holiday[]>("/admin/holidays", fetcher);
  const [form, setForm] = useState({ date: "", name: "", kind: "national" });
  const [error, setError] = useState<string | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/holidays", form);
      setForm({ date: "", name: "", kind: "national" });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    }
  }
  const years = [...new Set(data?.map((h) => h.date.slice(0, 4)))];
  return (
    <Panel title="Holidays and cuti bersama" description="Closed days for SLAs and leave counts. 2026 comes from SKB 3 Menteri No. 1497/2025, 2/2025 and 5/2025.">
      <form onSubmit={add} className="mb-3 grid gap-2 sm:grid-cols-[8.5rem_1fr_9rem_auto] sm:items-end">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </Field>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Kind">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="national">National holiday</option>
            <option value="cuti_bersama">Cuti bersama</option>
          </Select>
        </Field>
        <Button type="submit">Add</Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {!data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="max-h-72 overflow-y-auto">
          {years.map((y) => (
            <div key={y}>
              <div className="sticky top-0 bg-surface py-1 text-[12px] font-medium text-fg-2">
                {y} · {data.filter((h) => h.date.startsWith(y) && h.kind === "national").length} national,{" "}
                {data.filter((h) => h.date.startsWith(y) && h.kind === "cuti_bersama").length} cuti bersama
              </div>
              <ul className="divide-y divide-line text-[13px]">
                {data
                  .filter((h) => h.date.startsWith(y))
                  .map((h) => (
                    <li key={h.date} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="tabular w-28 shrink-0 text-fg-2">{fmtDate(h.date)}</span>
                      <span className="flex-1">{h.name}</span>
                      {h.kind === "cuti_bersama" && <Badge tone="outline">cuti bersama</Badge>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Webhooks() {
  const { data, mutate } = useSWR<Webhook[]>("/admin/webhooks", fetcher);
  const [form, setForm] = useState({ name: "", url: "", format: "json", events: ["task.escalated"] as string[] });
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ name: string; secret: string }>("/admin/webhooks", form);
      setCreated(r);
      setForm({ name: "", url: "", format: "json", events: ["task.escalated"] });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    }
  }

  return (
    <Panel
      title="Webhooks"
      description="Signed with HMAC-SHA256 (header x-arunika-signature: sha256=…). The Adaptive Card format is what a Microsoft Teams Workflows or Power Automate “When a HTTP request is received” trigger expects."
    >
      <form onSubmit={add} className="grid gap-3 lg:grid-cols-[1fr_2fr_10rem]">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="URL (https)">
          <Input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required placeholder="https://" />
        </Field>
        <Field label="Format">
          <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
            <option value="json">JSON</option>
            <option value="adaptive_card">Adaptive Card</option>
          </Select>
        </Field>
        <fieldset className="lg:col-span-3">
          <legend className="mb-1 text-[13px] font-medium text-fg-2">Events</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={form.events.includes(ev)}
                  onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev] : form.events.filter((x) => x !== ev) })}
                />
                <code className="font-mono text-[12px]">{ev}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="lg:col-span-3">
          <Button type="submit" disabled={!form.events.length}>
            Add webhook
          </Button>
        </div>
      </form>
      <div className="mt-3 space-y-3">
        <ErrorNote>{error}</ErrorNote>
        {created && (
          <Note tone="warning">
            Secret for {created.name}, shown once: <code className="font-mono">{created.secret}</code>
          </Note>
        )}
        {data && data.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>URL</Th>
                <Th>Events</Th>
                <Th>Format</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id} className={w.active ? undefined : "opacity-50"}>
                  <Td className="font-medium">{w.name}</Td>
                  <Td className="max-w-xs truncate font-mono text-[12px]">{w.url}</Td>
                  <Td className="text-[12px]">{w.events.join(", ")}</Td>
                  <Td>{w.format}</Td>
                  <Td className="text-right">
                    {w.active ? (
                      <Button size="sm" variant="ghost" onClick={async () => { await api.del(`/admin/webhooks/${w.id}`); mutate(); }}>
                        Disable
                      </Button>
                    ) : (
                      "disabled"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Panel>
  );
}

function Deliveries() {
  const { data } = useSWR<Delivery[]>("/admin/outbox", fetcher, { refreshInterval: 30_000 });
  return (
    <Panel title="Webhook deliveries" description="The outbox: written in the same transaction as the change, sent on the next tick, retried with backoff up to five times." bodyClassName="p-0">
      {!data ? (
        <div className="p-4">
          <Skeleton className="h-24" />
        </div>
      ) : data.length === 0 ? (
        <Empty title="No deliveries yet">Add a webhook, then act on a task; the next tick sends it.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Queued</Th>
              <Th>Event</Th>
              <Th>Webhook</Th>
              <Th>Attempts</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <Td className="whitespace-nowrap text-fg-2">{fmtDateTime(d.createdAt)}</Td>
                <Td className="font-mono text-[12px]">{d.event}</Td>
                <Td>{d.webhook}</Td>
                <Td className="tabular">{d.attempts}</Td>
                <Td>
                  {d.deliveredAt ? (
                    <Badge tone="good">Delivered {d.lastStatus}</Badge>
                  ) : d.attempts ? (
                    <Badge tone="critical">{d.lastError ?? "Failed"}</Badge>
                  ) : (
                    <Badge tone="neutral">Waiting</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
