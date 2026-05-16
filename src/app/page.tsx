"use client";

// Mission Control — overview page. Agent cards with live status pills,
// recent activity stream from the bus.

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Zap } from "lucide-react";
import Pill, { type PillTone } from "@/components/Pill";
import { accentFor } from "@/lib/accent";

interface AgentSummary {
  name: string;
  displayName: string;
  transport: string;
  status: PillTone;
  version?: string;
  latencyMs?: number;
}

interface BusEvent {
  id: string;
  ts: number;
  source: string;
  kind: string;
  payload?: unknown;
}

export default function MissionControl() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [events, setEvents] = useState<BusEvent[]>([]);

  // Periodic vitals refresh.
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setAgents(j.agents);
        }
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  // Live bus events.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        const evt = JSON.parse(m.data) as BusEvent;
        setEvents((prev) => [evt, ...prev].slice(0, 25));
      } catch { /* keepalive comments don't parse */ }
    };
    return () => es.close();
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="text-[20px] font-medium tracking-tight">Agents</h2>
          <Link
            href="/agents"
            className="text-[12px] text-[var(--fg-dim)] hover:text-[var(--fg)] flex items-center gap-1"
          >
            all agents <ArrowRight size={12} />
          </Link>
        </header>

        {agents.length === 0 ? (
          <div className="panel p-8 text-center text-[var(--fg-dim)] text-[13px]">
            No agents loaded. Add manifests to <code>agents/builtin/</code> or
            <code> ~/.agentic-os/agents/</code>.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((a) => {
              const accent = accentFor(a.name);
              return (
                <Link
                  key={a.name}
                  href={`/agents/${a.name}`}
                  className="panel p-5 hover:bg-[var(--bg-elevated-hot)] transition group"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          background: accent,
                          boxShadow: `0 0 12px -2px ${accent}`,
                        }}
                      />
                      <div className="leading-tight">
                        <div className="text-[14px] font-medium">{a.displayName}</div>
                        <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mt-0.5">
                          {a.name} · {a.transport}
                        </div>
                      </div>
                    </div>
                    <Pill tone={a.status} pulse={a.status === "live"}>
                      {a.status}
                    </Pill>
                  </div>
                  <div className="text-[11px] text-[var(--fg-dimmer)] flex items-center justify-between">
                    <span>{a.version ?? "version unknown"}</span>
                    <span className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                      open room <ArrowRight size={11} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="text-[20px] font-medium tracking-tight flex items-center gap-2">
            <Zap size={16} className="text-[var(--fg-dim)]" />
            Live activity
          </h2>
          <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">
            last {events.length} · streaming
          </span>
        </header>
        <div className="panel">
          {events.length === 0 ? (
            <div className="p-8 text-center text-[var(--fg-dim)] text-[13px]">
              Waiting for events from the bus…
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="px-5 py-2.5 text-[12px] grid grid-cols-[64px_120px_180px_1fr] gap-3 items-baseline font-[var(--font-geist-mono)]"
                  >
                    <span className="text-[var(--fg-dimmer)]">
                      {new Date(e.ts).toISOString().slice(11, 19)}
                    </span>
                    <span
                      className="font-medium"
                      style={{ color: accentFor(e.source) }}
                    >
                      {e.source}
                    </span>
                    <span className="text-[var(--fg-dim)]">{e.kind}</span>
                    <span className="text-[var(--fg-dimmer)] truncate">
                      {e.payload !== undefined ? JSON.stringify(e.payload) : ""}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
