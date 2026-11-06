"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";

import { Button, ErrorNote, Field, Input, Note, PageHeader, Panel, Select, Stat, Textarea } from "@/components/ui";
import { api, fetcher } from "@/lib/api";
import { fmtDate, todayISO } from "@/lib/format";
import { useMe } from "@/lib/session";
import type { Balance, LeavePreview, LeaveType } from "@/lib/types";

export function LeaveForm() {
  const router = useRouter();
  const { me } = useMe();
  const { data: types } = useSWR<LeaveType[]>("/leave/types", fetcher);
  const { data: balance } = useSWR<Balance>("/leave/balance", fetcher);
  const [form, setForm] = useState({ type: "annual", start: "", end: "", reason: "", reference: "" });
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = useMemo(() => types?.find((t) => t.code === form.type), [types, form.type]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.start || !form.end) return;
    const t = setTimeout(() => {
      api
        .post<LeavePreview>("/leave/preview", { type: form.type, start: form.start, end: form.end, reference: form.reference || null })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form.type, form.start, form.end, form.reference]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: number }>("/requests/leave", {
        type: form.type,
        start: form.start,
        end: form.end,
        reason: form.reason || undefined,
        reference: form.reference || null,
      });
      router.push(`/requests/${r.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
      setBusy(false);
    }
  }

  const available = types?.filter((t) => !t.gender || t.gender === me?.gender) ?? [];
  const ready = form.start && form.end && preview && preview.errors.length === 0;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/requests" className="hover:underline">
            Requests
          </Link>
        }
        title="Request leave"
        description="Working days are counted against the 2026 national holidays and cuti bersama. The request goes to your line manager; more than five days also needs your department head."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Type" hint={type ? `${type.basis}${type.maxDays ? ` · at most ${type.maxDays} ${type.unit === "calendar_days" ? "calendar" : "working"} days` : ""}` : undefined}>
              <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
                {available.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                    {!t.paid ? " (unpaid)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First day">
                <Input type="date" min={form.type === "sick" ? undefined : todayISO()} value={form.start} onChange={(e) => set("start", e.target.value)} required />
              </Field>
              <Field label="Last day">
                <Input type="date" min={form.start || undefined} value={form.end} onChange={(e) => set("end", e.target.value)} required />
              </Field>
            </div>
            {type?.needsReference && (
              <Field label={type.needsReference}>
                <Input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="e.g. SKD/2026/0412" />
              </Field>
            )}
            <Field label="Note for your manager (optional)">
              <Textarea rows={2} value={form.reason} onChange={(e) => set("reason", e.target.value)} maxLength={500} />
            </Field>
            {preview && preview.errors.length > 0 && <ErrorNote>{preview.errors.join(" ")}</ErrorNote>}
            {preview && preview.warnings.length > 0 && <Note tone="warning">{preview.warnings.join(" ")}</Note>}
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </form>
        </Panel>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label={type?.unit === "calendar_days" ? "Calendar days" : "Working days"}
              value={preview && form.start && form.end ? preview.days : "—"}
              sub={form.start && form.end ? `${fmtDate(form.start)} to ${fmtDate(form.end)}` : "Pick the dates"}
            />
            <Stat
              label="Annual leave left after"
              value={preview?.balanceAfter ?? balance?.remaining ?? "—"}
              sub={type?.code === "annual" ? "Pending requests already counted" : "This type does not use annual leave"}
            />
          </div>
          {balance && (
            <Panel title={`Annual leave ${balance.year}`}>
              <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
                <dt className="text-fg-3">Entitlement</dt>
                <dd className="tabular text-right">{balance.entitled}</dd>
                <dt className="text-fg-3">Carried over</dt>
                <dd className="tabular text-right">{balance.carriedOver}</dd>
                <dt className="text-fg-3">Taken</dt>
                <dd className="tabular text-right">−{balance.used}</dd>
                <dt className="text-fg-3">Waiting for approval</dt>
                <dd className="tabular text-right">−{balance.pending}</dd>
                <dt className="border-t border-line pt-1.5 font-medium">Remaining</dt>
                <dd className="tabular border-t border-line pt-1.5 text-right font-medium">{balance.remaining}</dd>
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
