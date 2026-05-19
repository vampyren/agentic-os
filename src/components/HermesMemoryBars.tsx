"use client";

// Two thin bars showing Hermes's MEMORY.md and USER.md usage against
// their character caps (default 5000 each — read from Hermes's
// config.yaml when present).
//
// Hermes ref: https://hermes-agent.nousresearch.com/docs/integrations/#memory--personalization
//
// Display-only: hover the bar for "N / cap chars · XX%". Two variants:
//   - "compact": for the Mission Control portal card (no labels, 4px bars).
//   - "full":    for the per-agent Control Room left rail (label column, 6px bars).
//
// Renders null when Hermes isn't installed on this host so non-Hermes
// agents don't carry empty UI.

import { useEffect, useState } from "react";
import { Brain, UserRound } from "lucide-react";
import { accentFor } from "@/lib/accent";

interface MemorySlot {
  chars: number;
  cap: number;
  missing: boolean;
}

interface MemoryUsage {
  ts: number;
  available: boolean;
  memory: MemorySlot;
  user: MemorySlot;
}

type Variant = "compact" | "full";

export default function HermesMemoryBars({ variant = "full" }: { variant?: Variant }) {
  const [data, setData] = useState<MemoryUsage | null>(null);
  const accent = accentFor("hermes");

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/hermes/memory-usage", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const json = (await r.json()) as MemoryUsage;
        if (!cancelled) setData(json);
      } catch {
        /* keep last value */
      }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Hide if no data yet, or Hermes isn't installed on this host.
  if (!data || !data.available) return null;

  const iconSize = variant === "compact" ? 12 : 14;

  return (
    <div
      className={variant === "compact" ? "space-y-1.5" : "space-y-2"}
      data-testid="hermes-memory-bars"
    >
      <MemoryRow
        icon={<Brain size={iconSize} />}
        label="MEMORY"
        chars={data.memory.chars}
        cap={data.memory.cap}
        accent={accent}
        variant={variant}
      />
      <MemoryRow
        icon={<UserRound size={iconSize} />}
        label="USER"
        chars={data.user.chars}
        cap={data.user.cap}
        accent={accent}
        variant={variant}
      />
    </div>
  );
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  chars: number;
  cap: number;
  accent: string;
  variant: Variant;
}

function MemoryRow({ icon, label, chars, cap, accent, variant }: RowProps) {
  const safeCap = cap > 0 ? cap : 1;
  const ratio = chars / safeCap;
  const pct = Math.min(100, Math.round(ratio * 100));
  // Subtle severity: dim under 80%, warm at 80–95%, hot above 95%.
  const barColor =
    pct >= 95
      ? "var(--status-offline, #f87171)"
      : pct >= 80
        ? "var(--status-degraded, #fbbf24)"
        : accent;
  const tooltip = `${chars.toLocaleString()} / ${cap.toLocaleString()} chars · ${pct}%`;

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2" title={tooltip} aria-label={`${label}: ${tooltip}`}>
        <span style={{ color: accent }} className="opacity-80 shrink-0">
          {icon}
        </span>
        <div className="flex-1 h-1 rounded-full bg-[color:var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: barColor }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-[var(--fg-dimmer)] w-8 text-right shrink-0">
          {pct}%
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2.5"
      title={tooltip}
      aria-label={`${label}: ${tooltip}`}
    >
      <span style={{ color: accent }} className="shrink-0 opacity-80">
        {icon}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] w-14 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-[color:var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-[var(--fg-dim)] w-10 text-right shrink-0">
        {pct}%
      </span>
    </div>
  );
}
