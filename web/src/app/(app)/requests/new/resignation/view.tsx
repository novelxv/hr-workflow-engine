"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, ErrorNote, Field, Input, Note, PageHeader, Panel, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/format";

export function ResignationForm() {
  const router = useRouter();
  const [lastDay, setLastDay] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = lastDay ? Math.round((Date.parse(lastDay) - Date.parse(todayISO())) / 86_400_000) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: number }>("/requests/resignation", { last_day: lastDay, reason: reason || undefined });
      router.push(`/requests/${r.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit");
      setBusy(false);
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
        title="Resign"
        description="Your manager acknowledges it, then IT, General Affairs, Payroll and HR run the clearance in parallel, and HR holds an exit interview."
      />
      <Panel className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Last working day">
            <Input type="date" min={todayISO()} value={lastDay} onChange={(e) => setLastDay(e.target.value)} required />
          </Field>
          {notice !== null && notice < 30 && (
            <Note tone="warning">That is {notice} days from today. Company policy asks for 30 days&apos; notice; HR will see this on the request.</Note>
          )}
          <Field label="Reason (optional, seen by your manager and HR)">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" variant="primary" disabled={!lastDay || busy}>
            {busy ? "Submitting…" : "Submit resignation"}
          </Button>
        </form>
      </Panel>
    </>
  );
}
