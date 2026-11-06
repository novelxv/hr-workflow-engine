"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import useSWR from "swr";

import { api, fetcher } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { isAdmin, isHr, useMe } from "@/lib/session";
import type { Me, Notification } from "@/lib/types";
import { MenuIcon } from "./icons";
import { Skeleton, cx } from "./ui";

const NAV: { href: string; label: string; show: (me?: Me) => boolean; exact?: boolean }[] = [
  { href: "/", label: "Inbox", show: () => true, exact: true },
  { href: "/requests", label: "Requests", show: () => true },
  { href: "/workflows", label: "Workflows", show: () => true },
  { href: "/analytics", label: "Process analytics", show: isHr },
  { href: "/admin", label: "Admin", show: isAdmin },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#1d4d43" />
        <path d="M8 11h9a4 4 0 0 1 0 8H12a3 3 0 0 0 0 6h12" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <circle cx="24" cy="25" r="2.2" fill="#8fd0bd" />
      </svg>
      <div className="leading-tight">
        <div className="text-[14px] font-semibold text-fg">Arunika Workflows</div>
        <div className="text-[11px] text-fg-3">Arunika Life · synthetic data</div>
      </div>
    </Link>
  );
}

function NavLinks({ me, onNavigate }: { me?: Me; onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((n) => n.show(me)).map((n) => {
        const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={cx(
              "rounded-md px-2.5 py-1.5 text-[13.5px]",
              active ? "bg-ink-soft font-medium text-ink" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Notifications() {
  const { data, mutate } = useSWR<Notification[]>("/notifications", fetcher, { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const unread = data?.filter((n) => !n.readAt).length ?? 0;
  async function toggle() {
    setOpen((v) => !v);
    if (!open && unread) {
      await api.post("/notifications/read");
      mutate();
    }
  }
  return (
    <div className="relative">
      <button onClick={toggle} className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13.5px] text-fg-2 hover:bg-surface-3">
        <span>Notifications</span>
        {unread > 0 && <span className="rounded bg-ink px-1.5 text-[11px] font-medium text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 z-20 max-h-96 w-80 overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
          {!data?.length ? (
            <div className="px-3 py-4 text-[13px] text-fg-3">Nothing yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {data.map((n) => (
                <li key={n.id}>
                  <Link href={n.link ?? "/"} onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-surface-2">
                    <div className="text-[13px] font-medium text-fg">{n.title}</div>
                    <div className="text-[12.5px] text-fg-2">{n.body}</div>
                    <div className="mt-0.5 text-[11.5px] text-fg-3">{fmtDateTime(n.at)} WIB</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { me, isLoading } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    await api.post("/auth/logout");
    router.replace("/login");
  }

  const nav = isLoading ? (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="mx-2 my-1.5 h-5" />
      ))}
    </div>
  ) : (
    <Suspense>
      <NavLinks me={me} onNavigate={() => setMenuOpen(false)} />
    </Suspense>
  );

  const account = me && (
    <div className="border-t border-line px-3 py-3">
      <div className="truncate text-[13px] font-medium text-fg">{me.fullName}</div>
      <div className="truncate text-[12px] text-fg-3">
        {me.position} · {me.employeeNo}
      </div>
      <button onClick={signOut} className="mt-2 text-[12.5px] text-link hover:underline">
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="px-3 py-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2">{nav}</div>
        <div className="px-2 pb-2">{me && <Notifications />}</div>
        {account}
      </aside>
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Brand />
        <button onClick={() => setMenuOpen((v) => !v)} className="rounded-md p-1.5 text-fg-2 hover:bg-surface-3" aria-label="Menu" aria-expanded={menuOpen}>
          <MenuIcon size={20} />
        </button>
      </header>
      {menuOpen && (
        <div className="border-b border-line bg-surface px-2 pb-2 lg:hidden">
          {nav}
          {account}
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
