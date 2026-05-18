"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { LayoutGrid, Target, BookOpen, Search } from "lucide-react";
import { APP_VERSION_LABEL } from "@/lib/appVersion";
import { accentFor } from "@/lib/accent";
import AgentAvatar from "./AgentAvatar";

interface AgentNav {
  name: string;
  displayName?: string;
}

interface VitalsResponse {
  ts: number;
  agents: Array<{
    name: string;
    displayName: string;
    status: "live" | "degraded" | "offline" | "unknown";
    latencyMs?: number;
  }>;
}

type Tone = "live" | "degraded" | "offline" | "unknown";

function aggregateTone(v: VitalsResponse | null): Tone {
  if (!v?.agents.length) return "unknown";
  if (v.agents.some((a) => a.status === "offline")) return "offline";
  if (v.agents.some((a) => a.status === "degraded")) return "degraded";
  if (v.agents.every((a) => a.status === "live")) return "live";
  return "unknown";
}

const TONE_BORDER: Record<Tone, string | undefined> = {
  live:     undefined, // default panel-border
  degraded: "var(--status-degraded)",
  offline:  "var(--status-offline)",
  unknown:  undefined,
};

// Visible label per tone — the chip text must reflect status, not
// stay "All systems" forever. Reviewers correctly flagged that a
// status indicator whose text never changes with status is close to
// non-functional (review B2 / #2).
const TONE_LABEL: Record<Tone, string> = {
  live:     "All systems",
  degraded: "Degraded",
  offline:  "Offline",
  unknown:  "Standby",
};

interface NavItem {
  href: string;
  label: string;
  /** Pre-instantiated icon node. For agents this is an AgentAvatar; for
   *  module routes this is a lucide icon rendered inside the 7x7 tile. */
  icon: ReactNode;
  accent: string;
  /** Distinguishes agent rows (avatar IS the tile) from module rows
   *  (lucide icon wrapped in a neutral 7x7 tile). */
  isAgent?: boolean;
}

const WORKSPACE: NavItem[] = [
  {
    href: "/",
    label: "Mission Control",
    icon: <LayoutGrid size={16} />,
    accent: "#a855f7",
  },
];

// Self module accents kept inline for Slice 1. Slice 3 can promote them
// to a shared map if Mission Control's SelfCards end up sharing the same
// palette.
const SELF: NavItem[] = [
  { href: "/goals",   label: "Goals",   icon: <Target size={16} />,   accent: "#fbbf24" },
  { href: "/journal", label: "Journal", icon: <BookOpen size={16} />, accent: "#a3e635" },
  { href: "/memory",  label: "Memory",  icon: <Search size={16} />,   accent: "#22d3ee" },
];

function dimFor(accent: string): string {
  // Soft accent-tinted background for active rows. The two-stop gradient
  // gives a subtle deep-to-shallow sheen that reads as "deep purple tint"
  // for Workspace and "warm wash" for Self.
  return `linear-gradient(135deg, color-mix(in srgb, ${accent} 22%, transparent), color-mix(in srgb, ${accent} 12%, transparent))`;
}

function GroupLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[9px] uppercase tracking-[0.28em] text-[var(--fg-dimmer)] mb-2 px-1 ${className}`}>
      {children}
    </div>
  );
}

interface NavLinkProps extends NavItem {
  active: boolean;
}

function NavLink({ href, label, icon, accent, isAgent = false, active }: NavLinkProps) {
  return (
    <Link
      href={href}
      className="relative group flex items-center gap-3 px-3 py-2 rounded-xl transition"
      style={{
        background: active ? dimFor(accent) : "transparent",
        color: active ? "var(--fg)" : "var(--fg-dim)",
      }}
    >
      {active && (
        <motion.span
          layoutId="nav-indicator"
          className="absolute -left-1 top-1/2 -translate-y-1/2 w-[3px] h-[20px] rounded-r-full"
          style={{ background: accent, boxShadow: `0 0 14px ${accent}` }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      {isAgent ? (
        // Agent rows: avatar IS the tile (the AgentAvatar component handles
        // its own background + active treatment).
        <span className="shrink-0">{icon}</span>
      ) : (
        // Module rows: wrap the lucide icon in a neutral 7x7 tile that
        // tints with the accent when active.
        <span
          className="shrink-0 grid place-items-center w-7 h-7 rounded-lg transition"
          style={{
            background: active ? "rgba(255,255,255,0.05)" : "transparent",
            color: active ? accent : "var(--fg-dim)",
          }}
        >
          {icon}
        </span>
      )}
      <span className="text-[13px] font-medium">{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [agents, setAgents] = useState<AgentNav[]>([]);
  const [vitals, setVitals] = useState<VitalsResponse | null>(null);
  // Clock starts null on SSR so client/server HTML match; set in effect.
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { agents?: AgentNav[] } | null) => {
        if (cancelled || !data?.agents) return;
        const sorted = [...data.agents].sort((a, b) =>
          (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name),
        );
        setAgents(sorted);
      })
      .catch(() => {
        // Leave the runtime Agents section empty on fetch failure; static
        // nav still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Vitals + clock for the bottom status chip. Vitals tone tints the chip
  // border so the operator sees `degraded`/`offline` aggregate at a glance
  // without changing the visual character of the chip label.
  useEffect(() => {
    const setNow = () =>
      setTime(
        new Date().toLocaleTimeString("en-GB", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    setNow();
    const clock = setInterval(setNow, 15_000);

    const fetchVitals = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        if (r.ok) setVitals(await r.json());
      } catch {
        // Network blip — keep last value.
      }
    };
    void fetchVitals();
    const id = setInterval(fetchVitals, 15_000);

    return () => {
      clearInterval(clock);
      clearInterval(id);
    };
  }, []);

  function openPalette() {
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  }

  const tone = aggregateTone(vitals);
  const toneBorder = TONE_BORDER[tone];

  const agentNav: NavItem[] = agents.map((a) => {
    const accent = accentFor(a.name);
    const active = pathname === `/agents/${a.name}`;
    return {
      href: `/agents/${a.name}`,
      label: a.displayName ?? a.name,
      icon: <AgentAvatar name={a.name} displayName={a.displayName} size={22} active={active} />,
      accent,
      isAgent: true,
    };
  });

  return (
    <aside
      className="hidden md:flex flex-col w-[244px] shrink-0 px-4 py-6 border-r border-[var(--panel-border)] bg-[var(--panel)] backdrop-blur-xl sticky top-0 h-screen"
      style={{ boxShadow: "1px 0 28px -18px rgba(168, 85, 247, 0.45)" }}
    >
      <Link href="/" className="block mb-7">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--fg-dimmer)] mb-1">
          Local · 127.0.0.1
        </div>
        <div className="text-lg font-medium tracking-tight">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#22d3ee] via-[#a855f7] to-[#ec4899]">
            Agentic OS
          </span>
        </div>
      </Link>

      <LayoutGroup>
        <GroupLabel>Workspace</GroupLabel>
        <nav className="flex flex-col gap-0.5 relative">
          {WORKSPACE.map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}

          <GroupLabel className="mt-3">Agents</GroupLabel>
          {agentNav.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[var(--fg-dimmer)]">…</div>
          ) : (
            agentNav.map((item) => (
              <NavLink key={item.href} {...item} active={pathname === item.href} />
            ))
          )}

          <GroupLabel className="mt-3">Self</GroupLabel>
          {SELF.map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}
        </nav>
      </LayoutGroup>

      {/* Compact shell controls — pushed to the bottom of the rail.
          Active nav item already carries page identity, so we don't repeat
          it here; the chips below carry command-palette access + aggregate
          status, with the clock+version on a single micro footer line. */}
      <div className="mt-auto pt-6 border-t border-[var(--panel-border)] flex flex-col gap-2">
        <button
          onClick={openPalette}
          aria-label="Open command palette"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--panel-border)] hover:border-[var(--panel-border-hot)] text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)] transition"
        >
          <span>⌘K</span>
          <span>Command palette</span>
        </button>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] text-[var(--fg-dim)] transition"
          style={{ borderColor: toneBorder ?? "var(--panel-border)" }}
          title={tone === "live" ? "All loaded agents healthy" : `Aggregate vitals: ${tone}`}
        >
          <span className="inline-flex items-center">
            {/* Match Julian's reference: the signal bars are an ambient
                pulse, while the text/border communicate the actual tone. */}
            <span className="tick-bar live" style={{ color: "#22d3ee" }} />
            <span className="tick-bar live" style={{ color: "#a855f7", animationDelay: ".15s" }} />
            <span className="tick-bar live" style={{ color: "#ec4899", animationDelay: ".3s" }} />
            <span className="tick-bar live" style={{ color: "#fbbf24", animationDelay: ".45s" }} />
          </span>
          <span className="uppercase tracking-widest">{TONE_LABEL[tone]}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-[var(--fg-dimmer)]">
          <span suppressHydrationWarning>{time || "—"}</span>
          <span>{APP_VERSION_LABEL}</span>
        </div>
      </div>
    </aside>
  );
}
