"use client";

import Link from "next/link";
import useSWR from "swr";

import { ErrorNote, PageHeader, Panel, Skeleton } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { CatalogEntry } from "@/lib/types";

const TRIGGER: Record<string, string> = {
  form: "Started from a form",
  event: "Started by an HRIS event",
  schedule: "Started by the daily scan",
};

export default function WorkflowsPage() {
  const { data, error } = useSWR<CatalogEntry[]>("/definitions", fetcher);
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Each workflow is a versioned definition. Publishing a new version affects requests started after it; anything already running finishes on the version it started with."
      />
      {error && <ErrorNote>{error.message}</ErrorNote>}
      <div className="grid gap-4 md:grid-cols-2">
        {!data
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)
          : data.map((w) => {
              const human = w.definition.steps.reduce(
                (n, s) => n + (["approval", "task", "decision"].includes(s.type) ? 1 : 0) + (s.branches?.length ?? 0),
                0,
              );
              return (
                <Link key={w.key} href={`/workflows/${w.key}`} className="block">
                  <Panel className="h-full transition-colors hover:border-line-strong">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-[15px] font-semibold">{w.name}</h2>
                      <span className="text-[12px] text-fg-3">
                        v{w.version} · {w.versions} version{w.versions === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-fg-2">{w.definition.description}</p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-3">
                      <span>{TRIGGER[w.definition.trigger.type]}</span>
                      <span>{w.definition.steps.length} steps, {human} for people</span>
                      <span>
                        {w.running} running of {w.total}
                      </span>
                      <span>published {fmtDate(w.publishedAt)}</span>
                    </div>
                  </Panel>
                </Link>
              );
            })}
      </div>
    </>
  );
}
