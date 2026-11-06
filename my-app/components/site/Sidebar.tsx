"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NEURAL = [
  { href: "/neural-network", label: "Overview" },
  { href: "/neural-network/walkthrough", label: "Walkthrough" },
  { href: "/neural-network/simulator", label: "Simulator" },
];

const UPCOMING = ["LLMs", "Computer Vision", "Machine Learning", "Build a Web App with AI"];

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <g stroke="var(--signal)" strokeWidth="1.2" fill="none" opacity="0.8">
        <path d="M4 5 18 11M4 17 18 11M4 5 11 11M4 17 11 11" />
      </g>
      <circle cx="4" cy="5" r="2.6" fill="var(--signal)" />
      <circle cx="4" cy="17" r="2.6" fill="var(--signal)" />
      <circle cx="18" cy="11" r="3" fill="var(--grad)" />
    </svg>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Topics" className="flex flex-col gap-6 px-3 py-4 text-[14px]">
      <div>
        <div className="px-2 pb-1.5 text-[12.5px] font-semibold text-[var(--text)]">Neural Networks</div>
        <ul className="flex flex-col gap-0.5">
          {NEURAL.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-2 py-1.5 transition-colors ${
                    active
                      ? "bg-[var(--raised)] text-[var(--text)]"
                      : "text-[var(--text-soft)] hover:bg-[var(--raised)]/60 hover:text-[var(--text)]"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <div className="px-2 pb-1.5 text-[12.5px] font-semibold text-[var(--muted)]">Coming later</div>
        <ul className="flex flex-col gap-0.5">
          {UPCOMING.map((label) => (
            <li key={label} className="px-2 py-1.5 text-[var(--muted)]">
              {label}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* phone and small tablet */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-4 lg:hidden">
        <Mark />
        <Link href="/neural-network" className="font-display text-[19px] text-[var(--text)]">
          Neuron Notes
        </Link>
        <button type="button" className="btn btn-small ml-auto" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Menu
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 top-12 z-30 bg-[var(--bg)] lg:hidden">
          <Nav onNavigate={() => setOpen(false)} />
        </div>
      )}

      {/* desktop */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg)] transition-[width] duration-200 lg:flex ${
          collapsed ? "w-12" : "w-56"
        }`}
      >
        <div className={`flex h-14 items-center gap-2 ${collapsed ? "justify-center" : "px-4"}`}>
          {!collapsed && <Mark />}
          {!collapsed && (
            <Link href="/neural-network" className="font-display whitespace-nowrap text-[19px] text-[var(--text)]">
              Neuron Notes
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Show sidebar" : "Hide sidebar to give the stage more room"}
            className={`cursor-pointer rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--raised)] hover:text-[var(--text)] ${
              collapsed ? "" : "ml-auto"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <rect x="1.7" y="2.7" width="12.6" height="10.6" rx="2" />
              <path d="M6 3v10" />
            </svg>
          </button>
        </div>
        {!collapsed && <Nav />}
      </aside>
    </>
  );
}
