"use client";

// ⌘+K command palette. Jump to any page, jump straight into any agent's
// room. Mounted globally from the Shell so it's reachable from anywhere.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutGrid, Bot, Target, BookOpen, Search, Activity,
} from "lucide-react";

interface AgentRow {
  name: string;
  displayName: string;
  transport: string;
}

const NAV_ROUTES = [
  { href: "/",         label: "Mission Control", icon: LayoutGrid },
  { href: "/agents",   label: "All agents",      icon: Bot },
  { href: "/goals",    label: "Goals",           icon: Target },
  { href: "/journal",  label: "Journal",         icon: BookOpen },
  { href: "/memory",   label: "Memory",          icon: Search },
  { href: "/events",   label: "Event Log",       icon: Activity },
] as const;

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const router = useRouter();

  // Keyboard toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lazy-load agent list when palette opens (so it stays fresh if you add
  // an agent and re-open).
  useEffect(() => {
    if (!open) return;
    fetch("/api/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAgents(j.agents ?? []))
      .catch(() => {});
  }, [open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] px-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      onClick={() => setOpen(false)}
    >
      <Command
        label="Global command palette"
        className="w-full max-w-[520px] panel overflow-hidden shadow-2xl"
        style={{ background: "rgba(20,21,24,0.95)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          placeholder="Jump to anything…"
          className="w-full !border-0 !rounded-none !bg-transparent !px-5 !py-4 !text-[14px] border-b border-[var(--border)]"
        />
        <Command.List className="max-h-[320px] overflow-y-auto scroll p-2">
          <Command.Empty className="px-3 py-6 text-center text-[12px] text-[var(--fg-dim)]">
            No matches.
          </Command.Empty>

          <Command.Group
            heading="Navigate"
            className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] px-3 py-1.5"
          >
            {NAV_ROUTES.map((r) => {
              const Icon = r.icon;
              return (
                <Command.Item
                  key={r.href}
                  onSelect={() => go(r.href)}
                  value={`nav ${r.label} ${r.href}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] text-[var(--fg-dim)] data-[selected=true]:bg-[var(--bg-elevated-hot)] data-[selected=true]:text-[var(--fg)] cursor-pointer"
                >
                  <Icon size={14} strokeWidth={1.75} />
                  <span>{r.label}</span>
                  <span className="ml-auto text-[10px] text-[var(--fg-dimmer)]">{r.href}</span>
                </Command.Item>
              );
            })}
          </Command.Group>

          {agents.length > 0 && (
            <Command.Group
              heading="Open agent room"
              className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] px-3 py-1.5 mt-1"
            >
              {agents.map((a) => (
                <Command.Item
                  key={a.name}
                  onSelect={() => go(`/agents/${a.name}`)}
                  value={`agent ${a.name} ${a.displayName} ${a.transport}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] text-[var(--fg-dim)] data-[selected=true]:bg-[var(--bg-elevated-hot)] data-[selected=true]:text-[var(--fg)] cursor-pointer"
                >
                  <Bot size={14} strokeWidth={1.75} />
                  <span>{a.displayName}</span>
                  <span className="ml-auto text-[10px] text-[var(--fg-dimmer)]">{a.transport}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>

        <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex items-center justify-between">
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span>⌘K to toggle</span>
        </div>
      </Command>
    </div>
  );
}
