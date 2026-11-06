"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";

import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api, fetcher } from "@/lib/api";

interface DemoAccounts {
  password: string | null;
  accounts: { email: string; label: string; roles: string[]; fullName: string; position: string }[];
}

const WHAT_THEY_SEE: Record<string, string> = {
  Employee: "Raises leave and resignation, sees their own requests and the training task.",
  "Line manager": "Has approvals and a PKWT decision waiting.",
  "Department head": "Long leave, and an approval escalated from a manager who did not answer.",
  "HR business partner": "Reviews, exit interviews and the HR operations queue.",
  "IT support": "Day-one setup for a joiner who starts in two weeks.",
  "HRIS admin": "Publishes workflow versions, holidays, webhooks; payroll and GA queues.",
};

export function LoginView() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const { data: demo } = useSWR<DemoAccounts>("/auth/demo-accounts", fetcher);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: string, p: string) {
    setBusy(e);
    setError(null);
    try {
      await api.post("/auth/login", { email: e, password: p });
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_520px]">
      <section className="hidden flex-col justify-between bg-ink px-12 py-10 text-white lg:flex">
        <div className="text-[15px] font-semibold">Arunika Workflows</div>
        <div className="max-w-xl">
          <h1 className="text-[28px] font-semibold leading-tight">HR processes that route themselves and show where they get stuck.</h1>
          <ul className="mt-6 space-y-3 text-[14px] text-white/80">
            <li>Leave, onboarding, PKWT renewal and offboarding as versioned workflow definitions.</li>
            <li>
              Leave checked before it starts: working days against the 2026 holidays and cuti bersama, statutory
              limits under Pasal 93 and UU KIA, the balance.
            </li>
            <li>SLAs in working hours, with escalation up the reporting line when nobody acts.</li>
            <li>Renewal offered only while the PKWT total stays within five years, with compensation worked out.</li>
            <li>Process analytics over six months of simulated history.</li>
          </ul>
        </div>
        <p className="text-[12px] text-white/60">Arunika Life is a fictional life insurer. Every person and number here is synthetic.</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              signIn(email.trim(), password);
            }}
            className="mt-4 space-y-3"
          >
            <Field label="Work email">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" variant="primary" className="w-full" disabled={!!busy}>
              {busy === email.trim() ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {demo && demo.accounts.length > 0 && (
            <div className="mt-8">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-semibold">Demo accounts</h3>
                {demo.password && (
                  <span className="text-[12px] text-fg-3">
                    password <code className="font-mono text-fg-2">{demo.password}</code>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] text-fg-3">The same processes, seen from each seat.</p>
              <div className="mt-3 space-y-2">
                {demo.accounts.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    disabled={!!busy || !demo.password}
                    onClick={() => signIn(a.email, demo.password!)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{a.label}</span>
                      <span className="text-[12px] text-fg-3">{busy === a.email ? "Signing in…" : a.fullName}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-fg-2">{WHAT_THEY_SEE[a.label] ?? a.position}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
