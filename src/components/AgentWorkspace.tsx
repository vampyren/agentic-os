"use client";

// Per-agent workspace shell. Owns the Chat / Control Room mode toggle
// and the agent + vitals fetch. Mounts either <AgentRoom> (chat) or
// <ControlRoom> (action workbench) depending on the toggle.
//
// Why split into a wrapper:
// - Julian's reference structure (source-julian/.../app/hermes/page.tsx)
//   has top-level mode pills with chat and control-room as sibling
//   views, never nested. Putting the toggle here keeps AgentRoom pure
//   (just chat) and ControlRoom pure (just actions).
// - The agent manifest + vitals are needed by both modes; fetching here
//   avoids a duplicate round-trip when the operator toggles.
//
// v0.2.12 update: the top-row Agent tabs (Claude / Hermes chips) were
// removed — the sidebar already lists every agent, and the duplicated
// row was eating vertical real estate above the chat. The Alt+1/Alt+N
// keyboard shortcut for switching agents was preserved here because
// jumping to the Nth agent in the registry is faster than reaching for
// the mouse / sidebar row. Chat mode also gained a viewport height cap
// so the chat panel scrolls INTERNALLY (composer always pinned at the
// bottom of the panel, latest message visible on entry). Control Room
// keeps its existing loose layout because its viewer panel already has
// its own internal scroll.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Terminal } from "lucide-react";
import AgentRoom from "./AgentRoom";
import ControlRoom from "./ControlRoom";
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
  const router = useRouter();
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [mode, setMode] = useState<Mode>("chat");
  const [registry, setRegistry] = useState<AgentRow[]>([]);

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
        const agents = (list.agents as AgentRow[]) ?? [];
        setRegistry(agents);
        const a = agents.find((x) => x.name === name);
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

  // Alt+1 / Alt+2 / ... keyboard jump between agents. Moved here from
  // the deleted AgentTabs component (v0.2.12) so the shortcut survives
  // the row removal. The ordering matches the registry's display order
  // (which the sidebar's Agents group sorts by display name, so Alt+N
  // matches what's visible in the sidebar).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > registry.length) return;
      const target = registry[n - 1];
      if (!target || target.name === name) return;
      e.preventDefault();
      router.push(`/agents/${encodeURIComponent(target.name)}`);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry, name, router]);

  const hasActions = Boolean(agent?.actions && agent.actions.length > 0);

  // Chat mode caps to the viewport so the chat panel scrolls
  // internally; Control Room keeps a loose minimum because its viewer
  // panel owns its own internal scroll and the left rail can grow with
  // the agent's action list. The calc subtracts the TopBar block
  // (~120px), Shell vertical padding (48px) and the mode-toggle row
  // (~52px) so AgentRoom fills the remaining viewport.
  const chatHeightCap = "h-[calc(100dvh-220px)] min-h-[420px]";

  return (
    <div
      className={`flex flex-col gap-4 ${mode === "chat" ? chatHeightCap : "min-h-[70vh]"}`}
    >
      {/* Mode toggle. Only show "Control Room" when the agent declares
          actions — Claude has none, so chat is the only mode. */}
      {hasActions && (
        <div className="flex items-center gap-2 shrink-0" role="tablist" aria-label="Agent view mode">
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
