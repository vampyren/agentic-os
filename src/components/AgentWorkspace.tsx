"use client";

// Per-agent workspace shell. Owns the agent picker row, the Chat /
// Control Room mode toggle, and the agent + vitals fetch. Mounts
// either <AgentRoom> (chat) or <ControlRoom> (action workbench)
// depending on the toggle.
//
// Why split into a wrapper:
// - Julian's reference structure (source-julian/.../app/hermes/page.tsx)
//   has top-level mode pills with chat and control-room as sibling
//   views, never nested. Putting the toggle here keeps AgentRoom pure
//   (just chat) and ControlRoom pure (just actions).
// - The agent manifest + vitals are needed by both modes; fetching here
//   avoids a duplicate round-trip when the operator toggles.

import { useEffect, useState } from "react";
import { MessageSquare, Terminal } from "lucide-react";
import AgentRoom from "./AgentRoom";
import ControlRoom from "./ControlRoom";
import AgentTabs from "./AgentTabs";
import { accentFor } from "@/lib/accent";
import type { AgentActionConfig } from "@/kernel/types";
import type { PillTone } from "./Pill";

interface AgentRow {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
  actions?: AgentActionConfig[];
}

interface Vitals {
  status: PillTone;
  version?: string;
  latencyMs?: number;
  checkedAt?: number;
}

type Mode = "chat" | "control";

export default function AgentWorkspace({ name }: { name: string }) {
  const accent = accentFor(name);
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [mode, setMode] = useState<Mode>("chat");

  // Reset to chat on agent change — preserves operator expectation that
  // switching agents lands them in the conversation, not a tool view.
  useEffect(() => { setMode("chat"); }, [name]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [list, vit] = await Promise.all([
          fetch("/api/agents", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/vitals", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const a = (list.agents as AgentRow[]).find((x) => x.name === name);
        if (a) setAgent(a);
        const v = (vit.agents as Array<{ name: string } & Vitals>).find((x) => x.name === name);
        if (v) setVitals({
          status: v.status,
          version: v.version,
          latencyMs: v.latencyMs,
          checkedAt: v.checkedAt,
        });
      } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [name]);

  const hasActions = Boolean(agent?.actions && agent.actions.length > 0);

  return (
    <div className="flex flex-col gap-4 min-h-[70vh]">
      <AgentTabs current={name} />

      {/* Mode toggle. Only show "Control Room" when the agent declares
          actions — Claude has none, so chat is the only mode. */}
      {hasActions && (
        <div className="flex items-center gap-2" role="tablist" aria-label="Agent view mode">
          {[
            { key: "chat" as const,    label: "Chat",         icon: <MessageSquare size={13} /> },
            { key: "control" as const, label: "Control Room", icon: <Terminal size={13} /> },
          ].map((t) => {
            const active = mode === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setMode(t.key)}
                className="flex items-center gap-2 !px-3 !py-1.5 !rounded-full text-[12.5px] transition"
                style={{
                  background: active
                    ? `color-mix(in srgb, ${accent} 16%, transparent)`
                    : "transparent",
                  borderColor: active
                    ? `color-mix(in srgb, ${accent} 50%, var(--border))`
                    : "var(--border)",
                  color: active ? "var(--fg)" : "var(--fg-dim)",
                }}
              >
                {t.icon}{t.label}
              </button>
            );
          })}
        </div>
      )}

      {mode === "chat" ? (
        <AgentRoom name={name} />
      ) : (
        <ControlRoom
          name={name}
          agent={agent && {
            name: agent.name,
            displayName: agent.displayName,
            description: agent.description,
            transport: agent.transport,
            actions: agent.actions ?? [],
          }}
          accent={accent}
          vitals={vitals}
        />
      )}
    </div>
  );
}
