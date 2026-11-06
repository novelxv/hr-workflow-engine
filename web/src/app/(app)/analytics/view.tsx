"use client";

import { useState } from "react";
import useSWR from "swr";

import { BarList, TrendLine } from "@/components/charts";
import { assigneeText } from "@/components/flow";
import { Badge, ErrorNote, Note, PageHeader, Panel, Skeleton, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { WORKFLOW_LABEL, fmtHours, fmtShortDate } from "@/lib/format";
import type { Assignee } from "@/lib/types";

interface SummaryRow {
  key: string;
  started: number;
  running: number;
  finished: number;
  rejection_rate: number | null;
  cycle_median_hours: number | null;
  cycle_p90_hours: number | null;
}
interface StepRow {
  step: string;
  name: string;
  kind: string;
  assignee: Assignee;
  tasks: number;
  completed: number;
  open: number;
  overdue_open: number;
  median_hours: number | null;
  p90_hours: number | null;
  sla_met_pct: number | null;
  escalated: number;
}
interface LocationRow {
  location: string;
  tasks: number;
  median_hours: number | null;
  sla_met_pct: number;
}

const KEYS = ["leave_request", "onboarding", "contract_renewal", "offboarding"] as const;
type Key = (typeof KEYS)[number];

export function AnalyticsView() {
  const { data, error } = useSWR<{ since: string; summary: SummaryRow[]; weekly: { week: string; started: number; finished: number }[] }>(
    "/analytics/summary",
    fetcher,
  );
  const [key, setKey] = useState<Key>("onboarding");
  const { data: steps } = useSWR<StepRow[]>(`/analytics/steps/${key}`, fetcher);
  const [step, setStep] = useState<string | null>(null);
  const worst = steps ? [...steps].filter((s) => s.sla_met_pct !== null && s.completed >= 3).sort((a, b) => (a.sla_met_pct ?? 100) - (b.sla_met_pct ?? 100))[0] : undefined;
  const focus = step ?? worst?.step ?? null;
  const { data: byLocation } = useSWR<LocationRow[]>(focus ? `/analytics/steps/${key}/${focus}/by-location` : null, fetcher);

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  const summary = KEYS.map((k) => data?.summary.find((s) => s.key === k)).filter((s): s is SummaryRow => !!s);
  const focusRow = steps?.find((s) => s.step === focus);

  return (
    <>
      <PageHeader
        title="Process analytics"
        description="Durations are working hours (08:00–17:00 WIB, weekends and holidays excluded), the clock the SLAs run on. The last six months are simulated history plus anything done in the live app since."
      />
      <Panel title="Workflows" bodyClassName="p-0">
        {!data ? (
          <div className="p-4">
            <Skeleton className="h-32" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Workflow</Th>
                <Th className="text-right">Started</Th>
                <Th className="text-right">In progress</Th>
                <Th className="text-right">Median cycle</Th>
                <Th className="text-right">90th percentile</Th>
                <Th className="text-right">Rejected</Th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.key} className={cx("cursor-pointer hover:bg-surface-2", s.key === key && "bg-ink-soft/50")} onClick={() => { setKey(s.key as Key); setStep(null); }}>
                  <Td className="font-medium">{WORKFLOW_LABEL[s.key]}</Td>
                  <Td className="tabular text-right">{s.started}</Td>
                  <Td className="tabular text-right">{s.running}</Td>
                  <Td className="tabular text-right">{fmtHours(s.cycle_median_hours)}</Td>
                  <Td className="tabular text-right">{fmtHours(s.cycle_p90_hours)}</Td>
                  <Td className="tabular text-right">{s.rejection_rate === null ? "—" : `${s.rejection_rate}%`}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel className="mt-4" title="Requests started per week" description="All workflows. Hover a week for the count finished that week.">
        {data ? (
          <TrendLine
            height={200}
            valueLabel="started"
            points={data.weekly.map((w) => ({
              key: w.week,
              label: fmtShortDate(w.week),
              value: w.started,
              detail: <span className="text-fg-2">{w.finished} finished that week</span>,
            }))}
          />
        ) : (
          <Skeleton className="h-48" />
        )}
      </Panel>

      <div className="mt-6">
        <Tabs<Key>
          value={key}
          onChange={(k) => {
            setKey(k);
            setStep(null);
          }}
          tabs={KEYS.map((k) => ({ id: k, label: WORKFLOW_LABEL[k] }))}
        />
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Steps" description="Click a step to split it by office." bodyClassName="p-0">
          {!steps ? (
            <div className="p-4">
              <Skeleton className="h-48" />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Step</Th>
                  <Th className="text-right">Done</Th>
                  <Th className="text-right">Median</Th>
                  <Th className="text-right">P90</Th>
                  <Th className="text-right">On time</Th>
                  <Th className="text-right">Escalated</Th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.step} onClick={() => setStep(s.step)} className={cx("cursor-pointer hover:bg-surface-2", s.step === focus && "bg-ink-soft/50")}>
                    <Td>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[12px] text-fg-3">
                        {assigneeText(s.assignee)}
                        {s.open ? ` · ${s.open} open${s.overdue_open ? `, ${s.overdue_open} overdue` : ""}` : ""}
                      </div>
                    </Td>
                    <Td className="tabular text-right">{s.completed}</Td>
                    <Td className="tabular text-right">{fmtHours(s.median_hours)}</Td>
                    <Td className="tabular text-right">{fmtHours(s.p90_hours)}</Td>
                    <Td className="tabular text-right">
                      {s.sla_met_pct === null ? "—" : s.sla_met_pct < 70 ? <Badge tone="warning">{s.sla_met_pct}%</Badge> : `${s.sla_met_pct}%`}
                    </Td>
                    <Td className="tabular text-right">{s.escalated}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel
          title={focusRow ? `${focusRow.name}, by office` : "By office"}
          description={step ? "Median working hours per completed task." : "Showing the step with the lowest on-time rate. Median working hours per completed task."}
        >
          {byLocation ? (
            <div className="space-y-3">
              <BarList
                format={(v) => fmtHours(v)}
                items={byLocation.map((l) => ({
                  key: l.location,
                  label: l.location,
                  value: l.median_hours ?? 0,
                  sub: `${l.sla_met_pct}% on time · n=${l.tasks}`,
                }))}
              />
              {byLocation.some((l) => l.tasks < 5) && <Note>Some offices have fewer than five tasks; read the spread with care.</Note>}
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Panel>
      </div>
    </>
  );
}
