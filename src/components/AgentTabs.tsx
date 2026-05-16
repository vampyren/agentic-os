"use client";

// Top-row agent picker for the AgentRoom header. One chip per loaded agent,
// current agent highlighted with its accent. Click to navigate. Keyboard
// shortcut: Alt+1/2/3/... jumps to the Nth agent in the list (matches the
// chip's visible order).
//
// Operator request after v0.2.7: changing agents is the most-frequent action
// in the dashboard and was buried in the sidebar. A persistent top-row tab
// is faster and matches how Julian's mission-control style worked in the
// reference screenshots.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { accentFor } from "@/lib/accent";

interface AgentRow {
  name: string;
  displayName: string;
}

interface AgentTabsProps {
  /** Current agent name — the chip for this name renders as selected. */
  current: string;
}

export default function AgentTabs({ current }: AgentTabsProps) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const router = useRouter();

  // Load the list once on mount. Cheap call; the registry's /api/agents
  // route doesn't probe agent health, just lists manifests.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { agents?: AgentRow[] }) => {
        if (!cancelled) setAgents(j.agents ?? []);
      })
      .catch(() => { /* keep empty list — caller still renders the chat */ });
    return () => { cancelled = true; };
  }, []);

  // Alt+1 / Alt+2 / ... keyboard jump. Alt avoids conflicting with browser
  // tab nav (Ctrl+1 etc.) and OS shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > agents.length) return;
      const target = agents[n - 1];
      if (!target || target.name === current) return;
      e.preventDefault();
      router.push(`/agents/${encodeURIComponent(target.name)}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agents, current, router]);

  if (agents.length === 0) return null;

  return (
    <nav
      className="flex items-center gap-1.5 overflow-x-auto scroll pb-0.5"
      aria-label="Switch agent"
    >
      {agents.map((a, i) => {
        const isActive = a.name === current;
        const accent = accentFor(a.name);
        const shortcut = i < 9 ? `Alt+${i + 1}` : undefined;
        return (
          <button
            key={a.name}
            type="button"
            onClick={() => {
              if (isActive) return;
              router.push(`/agents/${encodeURIComponent(a.name)}`);
            }}
            title={shortcut ? `${a.displayName} (${shortcut})` : a.displayName}
            className="!px-3 !py-1.5 text-[12px] !rounded-full flex items-center gap-2 transition shrink-0"
            style={
              isActive
                ? {
                    background: `color-mix(in srgb, ${accent} 18%, transparent)`,
                    color: accent,
                    borderColor: `color-mix(in srgb, ${accent} 38%, var(--border))`,
                  }
                : {
                    background: "transparent",
                    color: "var(--fg-dim)",
                    borderColor: "var(--border)",
                  }
            }
            aria-current={isActive ? "page" : undefined}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: accent, opacity: isActive ? 1 : 0.55 }}
            />
            <span>{a.displayName}</span>
          </button>
        );
      })}
    </nav>
  );
}
