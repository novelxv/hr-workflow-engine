"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { FlowDiagram } from "@/components/flow";
import { Button, ErrorNote, Field, Input, PageHeader, Panel, Select, Skeleton, Tabs, Textarea, cx } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { isAdmin, useMe } from "@/lib/session";
import type { DefinitionVersion } from "@/lib/types";

type Tab = "diagram" | "json" | "changes" | "publish";

/** Line diff by longest common subsequence; definitions are a few hundred lines at most. */
function diffLines(a: string[], b: string[]) {
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

export function WorkflowDetail() {
  const { key } = useParams<{ key: string }>();
  const { me } = useMe();
  const { data, error, mutate } = useSWR<DefinitionVersion[]>(`/definitions/${key}`, fetcher);
  const [tab, setTab] = useState<Tab>("diagram");
  const [selected, setSelected] = useState<number | null>(null);

  const current = data?.find((v) => v.version === selected) ?? data?.[0];
  const previous = data?.find((v) => current && v.version === current.version - 1);
  const diff = useMemo(
    () =>
      current && previous
        ? diffLines(JSON.stringify(previous.definition, null, 2).split("\n"), JSON.stringify(current.definition, null, 2).split("\n"))
        : [],
    [current, previous],
  );

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (!data || !current) return <Skeleton className="h-72" />;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/workflows" className="hover:underline">
            Workflows
          </Link>
        }
        title={current.name}
        description={current.definition.description}
        actions={
          <Field label="Version" className="w-56">
            <Select value={current.version} onChange={(e) => setSelected(Number(e.target.value))}>
              {data.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {fmtDateTime(v.publishedAt)} · {v.publishedBy}
                </option>
              ))}
            </Select>
          </Field>
        }
      />
      {current.note && <p className="-mt-2 mb-4 text-[13px] text-fg-2">Release note: {current.note}</p>}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "diagram", label: "Steps" },
          { id: "json", label: "Definition" },
          { id: "changes", label: previous ? `Changes from v${previous.version}` : "Changes", hidden: !previous },
          { id: "publish", label: "Publish a new version", hidden: !isAdmin(me) },
        ]}
      />
      <div className="mt-4">
        {tab === "diagram" && (
          <Panel>
            <FlowDiagram steps={current.definition.steps} />
          </Panel>
        )}
        {tab === "json" && (
          <Panel bodyClassName="p-0">
            <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[12px] leading-relaxed text-fg">
              {JSON.stringify(current.definition, null, 2)}
            </pre>
          </Panel>
        )}
        {tab === "changes" && previous && (
          <Panel bodyClassName="p-0">
            <pre className="max-h-[70vh] overflow-auto py-3 font-mono text-[12px] leading-relaxed">
              {diff.map((d, i) => (
                <div
                  key={i}
                  className={cx(
                    "px-4",
                    d.kind === "add" && "bg-good-soft text-good",
                    d.kind === "del" && "bg-critical-soft text-critical",
                    d.kind === "same" && "text-fg-3",
                  )}
                >
                  {d.kind === "add" ? "+ " : d.kind === "del" ? "− " : "  "}
                  {d.text}
                </div>
              ))}
            </pre>
          </Panel>
        )}
        {tab === "publish" && <PublishForm latest={data[0]!} onPublished={() => { mutate(); setSelected(null); setTab("changes"); }} />}
      </div>
    </>
  );
}

function PublishForm({ latest, onPublished }: { latest: DefinitionVersion; onPublished: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(latest.definition, null, 2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Not valid JSON: ${e instanceof Error ? e.message : ""}`);
      return;
    }
    setBusy(true);
    try {
      await api.post(`/definitions/${latest.key}/versions`, { definition: parsed, note: note || undefined });
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={`Publish v${latest.version + 1}`}
      description="Edit the JSON and publish. The server checks the shape and the structure: every referenced step exists, ids are unique, every step can be reached, and the flow ends."
    >
      <div className="space-y-3">
        <Textarea rows={22} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-[12px]" spellCheck={false} />
        <Field label="Release note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" maxLength={300} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button variant="primary" disabled={busy} onClick={publish}>
          {busy ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </Panel>
  );
}
