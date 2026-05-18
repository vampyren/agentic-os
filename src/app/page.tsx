"use client";

// Mission Control — overview page. Vitals row + agent portal cards +
// Self section + activity stream. Rebuilt in Slice 3 to match the
// reference design (deep accent identity, glow effects, metric grids).

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, BookOpen, Brain } from "lucide-react";
import Vitals from "@/components/Vitals";
import AgentPortal from "@/components/AgentPortal";
import SelfCard from "@/components/SelfCard";
import AgentAvatar from "@/components/AgentAvatar";
import { accentFor } from "@/lib/accent";

interface AgentSummary {
  name: string;
  displayName: string;
  transport: string;
  status: "live" | "degraded" | "offline" | "unknown";
  version?: string;
  latencyMs?: number;
}

interface AgentManifest {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
}

interface BusEvent {
  id: string;
  ts: number;
  source: string;
  kind: string;
  payload?: unknown;
}

type PortalStatus = "ok" | "warn" | "err" | "unknown";

function portalStatusFor(s: AgentSummary["status"]): PortalStatus {
  if (s === "live") return "ok";
  if (s === "degraded") return "warn";
  if (s === "offline") return "err";
  return "unknown";
}

export default function MissionControl() {
  const [vitalsAgents, setVitalsAgents] = useState<AgentSummary[]>([]);
  const [manifests, setManifests] = useState<AgentManifest[]>([]);
  const [events, setEvents] = useState<BusEvent[]>([]);

  // Vitals (refreshed) + manifests (one-shot for descriptions).
  useEffect(() => {
    let cancelled = false;
    const tickVitals = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        if (r.ok && !cancelled) setVitalsAgents((await r.json()).agents ?? []);
      } catch {
        /* keep last value */
      }
    };
    const fetchManifests = async () => {
      try {
        const r = await fetch("/api/agents", { cache: "no-store" });
        if (r.ok && !cancelled) setManifests((await r.json()).agents ?? []);
      } catch {
        /* tagline falls back to transport name */
      }
    };
    void tickVitals();
    void fetchManifests();
    const id = setInterval(tickVitals, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Live bus events.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        const evt = JSON.parse(m.data) as BusEvent;
        setEvents((prev) => [evt, ...prev].slice(0, 25));
      } catch {
        /* keepalive comments don't parse */
      }
    };
    return () => es.close();
  }, []);

  // Merge manifest descriptions into vitals agents (so portal cards have
  // both real-time status and the static tagline).
  const portalAgents = vitalsAgents.map((a) => {
    const manifest = manifests.find((m) => m.name === a.name);
    return {
      ...a,
      description: manifest?.description ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <Vitals />

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--fg-dimmer)] mb-4">
          Agents · click to open control room
        </h2>
        {portalAgents.length === 0 ? (
          <div className="panel p-8 text-center text-[var(--fg-dim)] text-[13px]">
            No agents loaded. Add manifests to <code>agents/builtin/</code> or
            <code> ~/.agentic-os/agents/</code>.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {portalAgents.map((a) => (
              <AgentPortal
                key={a.name}
                href={`/agents/${a.name}`}
                title={a.displayName ?? a.name}
                tagline={a.description ?? `Transport: ${a.transport}`}
                icon={<AgentAvatar name={a.name} displayName={a.displayName} size={28} active />}
                accent={accentFor(a.name)}
                status={portalStatusFor(a.status)}
                metrics={[
                  { label: "Version", value: a.version?.split(" ")[0] ?? "—" },
                  { label: "Latency", value: a.latencyMs != null ? `${a.latencyMs}ms` : "—" },
                ]}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--fg-dimmer)] mb-4">
          Self · grounded in your Obsidian vault
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SelfCard
            href="/goals"
            title="Goals"
            tagline="Set the targets, tick them off, see the % bar fill."
            icon={<Target size={20} />}
            accent="#fbbf24"
            stat="Saved to your vault"
          />
          <SelfCard
            href="/journal"
            title="Journal"
            tagline="Daily entries, voice or text. One markdown file per day."
            icon={<BookOpen size={20} />}
            accent="#a3e635"
            stat="Daily files in vault"
          />
          <SelfCard
            href="/memory"
            title="Memory"
            tagline="Every chat auto-logged. Full vault search."
            icon={<Brain size={20} />}
            accent="#22d3ee"
            stat="Live · FTS5 indexed"
          />
        </div>
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--fg-dimmer)] mb-4">
          Live activity · combined log stream
        </h2>
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
                    className="px-5 py-2.5 text-[12px] grid grid-cols-[64px_120px_180px_1fr] gap-3 items-baseline font-mono"
                  >
                    <span className="text-[var(--fg-dimmer)]">
                      {new Date(e.ts).toISOString().slice(11, 19)}
                    </span>
                    <span className="font-medium" style={{ color: accentFor(e.source) }}>
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
