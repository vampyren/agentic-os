"use client";

// /agents — registry overview page (list of every loaded manifest with
// status + version). Intentionally NOT in the sidebar nav after v0.2.12
// Slice 1's redesign — sidebar is by-design minimal (Workspace / Agents
// runtime list / Self), and a separate "All agents" index would clutter
// it. The route stays reachable via:
//   - the command palette ("All agents" entry in NAV_ROUTES)
//   - direct URL navigation
// This is a deliberate UX call, not an orphan; do not silently delete
// the route without revisiting the decision.

import { useEffect, useState } from "react";
import Link from "next/link";
import Pill, { type PillTone } from "@/components/Pill";
import { accentFor } from "@/lib/accent";

interface AgentSummary {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
  status: PillTone;
  version?: string;
}

export default function AgentsIndex() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  useEffect(() => {
    const tick = async () => {
      try {
        const [list, vitals] = await Promise.all([
          fetch("/api/agents", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/vitals", { cache: "no-store" }).then((r) => r.json()),
        ]);
        const vitalsBy: Record<string, { status: PillTone; version?: string }> = {};
        for (const a of vitals.agents ?? []) vitalsBy[a.name] = { status: a.status, version: a.version };
        setAgents(
          (list.agents ?? []).map((a: { name: string; displayName: string; description: string | null; transport: string }) => ({
            ...a,
            status: vitalsBy[a.name]?.status ?? "unknown",
            version: vitalsBy[a.name]?.version,
          })),
        );
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((a) => {
          const accent = accentFor(a.name);
          return (
            <Link
              key={a.name}
              href={`/agents/${a.name}`}
              className="panel p-5 hover:bg-[var(--bg-elevated-hot)] transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: accent, boxShadow: `0 0 12px -2px ${accent}` }}
                  />
                  <div className="leading-tight">
                    <div className="text-[14px] font-medium">{a.displayName}</div>
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mt-0.5">
                      {a.name} · {a.transport}
                    </div>
                  </div>
                </div>
                <Pill tone={a.status} pulse={a.status === "live"}>{a.status}</Pill>
              </div>
              {a.description && (
                <div className="text-[12px] text-[var(--fg-dim)] leading-relaxed">
                  {a.description}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
