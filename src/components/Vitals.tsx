"use client";

// Mission Control vitals row (Slice 3). N agent tiles + Heartbeat
// (poll-tick counter) + Latency (combined p50 across agents). Refreshes
// every 4s like Julian's reference. Adapts to however many agents the
// registry has loaded — no hardcoded shape.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Bot, Zap, type LucideIcon } from "lucide-react";
import { accentFor } from "@/lib/accent";

interface AgentVital {
  name: string;
  displayName: string;
  transport: string;
  status: "live" | "degraded" | "offline" | "unknown";
  version?: string;
  latencyMs?: number;
}

interface VitalsResponse {
  ts: number;
  agents: AgentVital[];
}

type Tone = "ok" | "warn" | "err" | "info";

function toneFromStatus(s: AgentVital["status"]): Tone {
  if (s === "live") return "ok";
  if (s === "degraded") return "warn";
  if (s === "offline") return "err";
  return "warn";
}

const TONE_COLOR: Record<Tone, string> = {
  ok:   "text-emerald-400",
  warn: "text-amber-400",
  err:  "text-rose-400",
  info: "text-sky-400",
};

const TONE_LABEL: Record<Tone, string> = {
  ok:   "LIVE",
  warn: "WARN",
  err:  "DOWN",
  info: "INFO",
};

interface TileProps {
  accentColor: string;
  label: string;
  icon: LucideIcon;
  primary: string;
  sub?: string;
  tone: Tone;
}

function Tile({ accentColor, label, icon: Icon, primary, sub, tone }: TileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.35 }}
      className="panel panel-hover px-4 py-3"
      style={{
        // Each tile gets a soft accent glow so the row reads as a colour story.
        boxShadow: `0 0 30px -12px ${accentColor}`,
      }}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
        <span className="flex items-center gap-1.5">
          <Icon size={11} />
          {label}
        </span>
        <span className={`inline-flex items-center gap-1.5 ${TONE_COLOR[tone]}`}>
          <span className="heartbeat" />
          {TONE_LABEL[tone]}
        </span>
      </div>
      <div className="mt-1.5 text-2xl metric text-[var(--fg)]">{primary}</div>
      {sub && (
        <div className="mt-1 text-[11px] text-[var(--fg-dim)] truncate">{sub}</div>
      )}
    </motion.div>
  );
}

const POLL_INTERVAL_MS = 4000;

export default function Vitals() {
  const [data, setData] = useState<VitalsResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const r = await fetch("/api/vitals", { cache: "no-store" });
        if (r.ok && !cancelled) setData(await r.json());
      } catch {
        // Network blip — keep last value, increment tick.
      }
    };
    void fetchIt();
    const id = setInterval(() => {
      void fetchIt();
      setTick((n) => n + 1);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const agents = data?.agents ?? [];
  const combinedLatency = agents.reduce((sum, a) => sum + (a.latencyMs ?? 0), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {agents.map((a) => {
        const tone = toneFromStatus(a.status);
        const primary =
          a.status === "live" ? "ONLINE"
          : a.status === "degraded" ? "DEGRADED"
          : a.status === "offline" ? "OFFLINE"
          : "…";
        const sub = a.version
          ? `${a.version}${a.latencyMs != null ? ` · ${a.latencyMs}ms` : ""}`
          : a.transport;
        return (
          <Tile
            key={a.name}
            accentColor={accentFor(a.name)}
            label={a.displayName ?? a.name}
            icon={Bot}
            primary={primary}
            sub={sub}
            tone={tone}
          />
        );
      })}
      <Tile
        accentColor="#a855f7"
        label="Heartbeat"
        icon={Activity}
        primary={`${tick}`}
        sub={`poll ticks · ${POLL_INTERVAL_MS / 1000}s`}
        tone="info"
      />
      <Tile
        accentColor="#a3e635"
        label="Latency"
        icon={Zap}
        primary={agents.length > 0 ? `${combinedLatency}ms` : "…"}
        sub="combined across loaded agents"
        tone="ok"
      />
    </div>
  );
}
