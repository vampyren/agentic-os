"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid, Bot, Target, BookOpen, Search, Activity, Settings,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  matchPrefix?: boolean;
}

const NAV: NavItem[] = [
  { href: "/",        label: "Mission Control", icon: LayoutGrid },
  { href: "/agents",  label: "Agents",          icon: Bot,        matchPrefix: true },
  { href: "/goals",   label: "Goals",           icon: Target },
  { href: "/journal", label: "Journal",         icon: BookOpen },
  { href: "/memory",  label: "Memory",          icon: Search },
  { href: "/events",  label: "Event Log",       icon: Activity },
];

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <aside className="hidden md:flex md:w-[240px] md:flex-col gap-3 p-4 border-r border-[var(--border)] sticky top-0 h-screen">
      <Link
        href="/"
        className="flex items-center gap-2.5 px-2 py-3 mb-2 group"
      >
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-[12px]"
          style={{
            background: "linear-gradient(135deg, var(--accent-hermes), var(--accent-openclaw))",
            color: "#000",
          }}
        >
          A
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">Agentic OS</span>
          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
            v0.2.5 · ⌘K
          </span>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.matchPrefix
            ? pathname.startsWith(item.href) && (item.href !== "/" || pathname === "/")
            : pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition border ${
                active
                  ? "bg-[var(--bg-elevated-hot)] border-[var(--border-hot)] text-[var(--fg)]"
                  : "border-transparent text-[var(--fg-dim)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
              }`}
            >
              <Icon size={15} strokeWidth={1.75} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3 py-2 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center gap-2">
        <Settings size={12} />
        <span>local · 127.0.0.1</span>
      </div>
    </aside>
  );
}
