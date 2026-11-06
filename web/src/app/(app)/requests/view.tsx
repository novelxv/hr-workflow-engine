"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import {
  Badge,
  Button,
  Dialog,
  Empty,
  ErrorNote,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Panel,
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
} from "@/components/ui";
import { api, fetcher, qs } from "@/lib/api";
import { STATUS_LABEL, WORKFLOW_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import { isHr, useMe } from "@/lib/session";
import type { InstanceRow } from "@/lib/types";

type Scope = "mine" | "involved" | "team" | "all";
const TONE: Record<string, "good" | "critical" | "neutral" | "ink" | "warning"> = {
  running: "ink",
  approved: "good",
  completed: "good",
  rejected: "critical",
  cancelled: "neutral",
};

export function RequestsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { me } = useMe();
  const scope = (params.get("scope") as Scope) ?? "mine";
  const key = params.get("key") ?? "";
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const { data, error } = useSWR<{ total: number; page: number; pageSize: number; items: InstanceRow[] }>(
    "/instances" + qs({ scope, key, status, page, q: params.get("q") }),
    fetcher,
    { keepPreviousData: true },
  );
  const [onboarding, setOnboarding] = useState(false);

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Requests"
        description="Every process you started, are the subject of, or worked on. Each one keeps the workflow version it started on."
        actions={
          <>
            <LinkButton href="/requests/new/leave" variant="primary">
              Request leave
            </LinkButton>
            <LinkButton href="/requests/new/resignation">Resign</LinkButton>
            {isHr(me) && <Button onClick={() => setOnboarding(true)}>Start onboarding</Button>}
          </>
        }
      />
      <Tabs<Scope>
        value={scope}
        onChange={(s) => update({ scope: s })}
        tabs={[
          { id: "mine", label: "Mine" },
          { id: "involved", label: "I worked on" },
          { id: "team", label: "My team" },
          { id: "all", label: "Everything", hidden: !isHr(me) },
        ]}
      />
      <Panel className="mt-3" bodyClassName="p-0">
        <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-3">
          <Field label="Workflow">
            <Select value={key} onChange={(e) => update({ key: e.target.value })}>
              <option value="">All</option>
              {Object.entries(WORKFLOW_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => update({ status: e.target.value })}>
              <option value="">Any</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Search">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update({ q });
              }}
            >
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or employee number" />
            </form>
          </Field>
        </div>
        {error ? (
          <div className="p-4">
            <ErrorNote>{error.message}</ErrorNote>
          </div>
        ) : !data ? (
          <div className="p-4">
            <Skeleton className="h-48" />
          </div>
        ) : data.items.length === 0 ? (
          <Empty title="No requests here" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Request</Th>
                  <Th>Workflow</Th>
                  <Th>Started</Th>
                  <Th>Status</Th>
                  <Th>Now at</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/requests/${i.id}`} className="font-medium text-link hover:underline">
                        {i.title}
                      </Link>
                      <div className="text-[12px] text-fg-3">
                        {i.subjectName} · {i.subjectNo}
                        {i.simulated && " · simulated history"}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-fg-2">
                      {WORKFLOW_LABEL[i.key] ?? i.key} <span className="text-fg-3">v{i.version}</span>
                    </Td>
                    <Td className="tabular whitespace-nowrap text-fg-2">{fmtDateTime(i.startedAt)}</Td>
                    <Td>
                      <Badge tone={TONE[i.status] ?? "neutral"}>{STATUS_LABEL[i.status] ?? i.status}</Badge>
                    </Td>
                    <Td className="text-[12.5px] text-fg-2">
                      {i.status === "running" ? (i.waitUntil ? `Waiting until ${fmtDate(i.waitUntil)}` : i.cursor?.replaceAll("_", " ")) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) })} />
          </>
        )}
      </Panel>
      {onboarding && <OnboardingDialog onClose={() => setOnboarding(false)} />}
    </>
  );
}

function OnboardingDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data } = useSWR<{ id: number; employeeNo: string; fullName: string; position: string; location: string; hireDate: string }[]>(
    "/directory?upcoming=1",
    fetcher,
  );
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: number }>("/requests/onboarding", { employee_id: Number(choice) });
      router.push(`/requests/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start onboarding");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Start onboarding"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!choice || busy} onClick={start}>
            {busy ? "Starting…" : "Start"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-fg-2">
          Joiners with a future start date. In production this starts on its own when the HRIS sends an
          <code className="mx-1 font-mono text-[12px]">employee.hired</code>event.
        </p>
        <Field label="Joiner">
          <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose…</option>
            {data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} · {e.position}, {e.location} · starts {fmtDate(e.hireDate)}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Dialog>
  );
}
