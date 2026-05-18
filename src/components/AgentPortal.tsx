"use client";

// Mission Control agent portal card (Slice 3). Accent glow behind the
// identity tile, status indicator with heartbeat dot, two-metric grid,
// "Open agent workspace →" CTA. Whole card is a Link to the agent room.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

type PortalStatus = "ok" | "warn" | "err" | "unknown";

interface Metric {
  label: string;
  value: string;
}

interface Props {
  href: string;
  title: string;
  tagline: string;
  icon: ReactNode;
  accent: string;
  status: PortalStatus;
  metrics: [Metric, Metric];
}

const STATUS_COLOR: Record<PortalStatus, string> = {
  ok:      "text-emerald-400",
  warn:    "text-amber-400",
  err:     "text-rose-400",
  unknown: "text-zinc-500",
};

const STATUS_LABEL: Record<PortalStatus, string> = {
  ok:      "ONLINE",
  warn:    "DEGRADED",
  err:     "OFFLINE",
  unknown: "UNKNOWN",
};

export default function AgentPortal({
  href,
  title,
  tagline,
  icon,
  accent,
  status,
  metrics,
}: Props) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <Link href={href} className="block group">
      <motion.div
        // SSR-safe: initial={false} prevents framer-motion from
        // injecting the initial transform/opacity into server-rendered
        // HTML. AgentPortal currently only renders after the client
        // fetches /api/vitals (so it doesn't hit SSR in practice), but
        // the same pattern is applied across Slice 3 motion components
        // for consistency and to prevent regressions if a future change
        // ever renders these on the server. Hover motion stays gated.
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        whileHover={prefersReducedMotion ? undefined : { y: -3 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.35 }}
        className="panel panel-hover relative h-full p-5 overflow-hidden"
      >
        {/* Accent glow blob behind the identity tile. Intensifies on hover. */}
        <div
          className="pointer-events-none absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-30 blur-3xl transition group-hover:opacity-60"
          style={{ background: accent }}
        />

        <div className="relative flex items-start justify-between mb-3">
          <div
            className="grid place-items-center w-10 h-10 rounded-xl"
            style={{
              background: `color-mix(in srgb, ${accent} 18%, transparent)`,
              color: accent,
              boxShadow: `0 0 24px -8px ${accent}`,
            }}
          >
            {icon}
          </div>
          <span
            className={`text-[10px] font-medium tracking-[0.18em] flex items-center gap-1.5 ${STATUS_COLOR[status]}`}
          >
            <span className="heartbeat" />
            {STATUS_LABEL[status]}
          </span>
        </div>

        <div className="relative flex items-baseline justify-between gap-2">
          <h3
            className="text-xl font-medium tracking-tight"
            style={{ color: accent }}
          >
            {title}
          </h3>
          <ArrowUpRight
            size={16}
            className="text-[var(--fg-dimmer)] group-hover:text-[var(--fg)] transition opacity-60 group-hover:opacity-100"
          />
        </div>
        <p className="relative mt-1 text-[13px] text-[var(--fg-dim)] leading-snug line-clamp-2">
          {tagline}
        </p>

        <div className="relative mt-4 grid grid-cols-2 gap-2">
          {metrics.map((m, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--panel-border)] px-3 py-1.5"
            >
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                {m.label}
              </div>
              <div className="text-base metric mt-0.5 truncate text-[var(--fg)]">
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* Cards link to /agents/[name] which boots in Chat mode by
            default; the Control Room is one click away inside that
            workspace. Calling this "Open control room" was a UX contract
            mismatch (review B1 / #3) — wording corrected. Deep-linking
            Control Room via a query param is a future enhancement. */}
        <div className="relative mt-4 text-[11px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)] group-hover:text-[var(--fg-dim)] transition">
          Open agent workspace →
        </div>
      </motion.div>
    </Link>
  );
}
