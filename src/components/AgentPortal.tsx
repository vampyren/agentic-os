"use client";

// Mission Control agent portal card (Slice 3). Accent glow behind the
// identity tile, status indicator with heartbeat dot, two-metric grid,
// "Open agent workspace →" CTA. The main card body is a Link to the
// agent room.
//
// HTML validity (Slice E review fix): the `extras` slot may contain
// interactive controls (e.g. AgentCwdPicker's Folder button). The
// WHATWG content model forbids interactive content nested inside an
// <a>, so we render the Link to wrap ONLY the main card body and slot
// `extras` as a sibling INSIDE the motion.div but OUTSIDE the Link.
// The whole card still lifts on hover (motion.div owns the hover
// state) and the visual layout is unchanged for non-Hermes / non-
// Claude cards (which pass no extras).

import Link from "next/link";
import { motion } from "framer-motion";
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
  /** Optional extra slot rendered OUTSIDE the navigation Link (so its
   *  contents may include interactive elements without violating the
   *  HTML content model). Visually sits at the bottom of the card,
   *  below the "Open agent workspace" CTA. Used by Hermes for the
   *  MEMORY.md / USER.md bars and by Claude for the cwd picker. */
  extras?: ReactNode;
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
  extras,
}: Props) {
  return (
    <motion.div
      // SSR-safe: initial={false} prevents framer-motion from injecting
      // the initial transform/opacity into server-rendered HTML.
      // AgentPortal currently only renders after the client fetches
      // /api/vitals (so it doesn't hit SSR in practice), but the same
      // pattern is applied across Slice 3 motion components for
      // consistency and to prevent regressions if a future change
      // ever renders these on the server. Hover motion stays gated.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.35 }}
      className="panel panel-hover relative h-full p-5 overflow-hidden flex flex-col group"
    >
      {/* Accent glow blob behind the identity tile. Intensifies on hover. */}
      <div
        className="pointer-events-none absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-30 blur-3xl transition group-hover:opacity-60"
        style={{ background: accent }}
      />

      <Link href={href} className="block">
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
      </Link>

      {/* `extras` sits OUTSIDE the navigation Link so it can host
          interactive controls (a folder picker button, a popover
          trigger) without nesting interactive content inside an <a>
          (HTML content-model violation flagged in Jarvis's Slice E
          review). The whole card still lifts on hover because
          motion.div is the hover anchor; only NAVIGATION is gated to
          the upper block. */}
      {extras && <div className="relative mt-3 pt-3 border-t border-[var(--panel-border)]">{extras}</div>}
    </motion.div>
  );
}
