"use client";

// Agent identity glyph used by the sidebar agent rows, the Mission
// Control portal cards, and the chat header / chat bubbles. Two render
// modes:
//
//   1. KNOWN agents (claude-code, hermes, …): full brand glyph on an
//      accent-gradient circle with an outer accent glow + inner 1 px
//      white highlight ring. Glyphs adapted from Julian's v0.1 reference.
//   2. Unknown agents (future manifests, e.g. openclaw / a custom CLI):
//      first-letter fallback — same accent-gradient treatment, but the
//      glyph is the agent's initial in white. `accentFor()` picks a
//      stable hash-mapped colour when no `--accent-<name>` token exists.
//
// SSR-safe: motion.span uses `initial={false}` so framer-motion does
// not inject entrance styles into the server HTML (matches the Slice 2
// hydration-safety pattern).

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { accentFor } from "@/lib/accent";

interface Props {
  /** Manifest slug (used for known-glyph lookup + accent + aria label). */
  name: string;
  /** Display name from manifest; used for the aria-label and first-letter
   *  fallback. Falls back to `name` when absent. */
  displayName?: string;
  /** Pixel size of the circular tile. Default 32. */
  size?: number;
  /** Only consumed by the first-letter fallback. Bumps the tile to a
   *  brighter "selected" gradient when true. Known-glyph agents
   *  always render the full vibrant treatment regardless. */
  active?: boolean;
}

interface KnownAgent {
  accent: string;
  gradient: string;
  glyph: (size: number) => ReactNode;
}

// Per-known-agent visual identity. Hermes uses our project's cyan
// accent (--accent-hermes #22d3ee) rather than Julian's blue, so the
// avatar matches the rest of the app's per-agent palette (sidebar
// indicator, Mission Control tile glow, AgentPortal accent).
const KNOWN: Record<string, KnownAgent> = {
  "claude-code": {
    accent: "#d97757",
    gradient: "linear-gradient(135deg, #f4a07a, #c0563a)",
    glyph: (s) => (
      // 5-point star / diamond — Julian's Claude mark.
      <svg width={s * 0.55} height={s * 0.55} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2 L13.6 9 L21 10.4 L13.6 12.4 L12 22 L10.4 12.4 L3 10.4 L10.4 9 Z"
          fill="white"
          opacity="0.95"
        />
      </svg>
    ),
  },
  hermes: {
    accent: "#22d3ee",
    gradient: "linear-gradient(135deg, #67e8f9, #0891b2)",
    glyph: (s) => (
      // Caduceus-style wing mark — Julian's Hermes mark, recoloured to
      // sit on our cyan gradient.
      <svg width={s * 0.6} height={s * 0.6} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3 L12 21 M12 5 C 8 8, 6 7, 4 5 C 6 9, 9 10, 12 9 C 15 10, 18 9, 20 5 C 18 7, 16 8, 12 5"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />
        <circle cx="12" cy="3" r="1.2" fill="white" opacity="0.95" />
      </svg>
    ),
  },
};

function firstInitial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

export default function AgentAvatar({ name, displayName, size = 32, active = false }: Props) {
  const known = KNOWN[name];
  const label = displayName ?? name;

  // ─── Known-agent path: gradient circle + brand glyph + accent glow ──
  if (known) {
    return (
      <motion.span
        initial={false}
        whileHover={{ scale: 1.05 }}
        transition={{ type: "spring", stiffness: 380, damping: 25 }}
        className="relative inline-grid place-items-center rounded-full overflow-hidden shrink-0"
        style={{
          width: size,
          height: size,
          background: known.gradient,
          boxShadow: `0 0 ${size}px -${size / 3}px ${known.accent}, inset 0 0 0 1px rgba(255,255,255,0.12)`,
        }}
        aria-hidden="true"
        title={label}
      >
        {known.glyph(size)}
      </motion.span>
    );
  }

  // ─── Unknown-agent fallback: first-letter on accent-gradient circle ──
  const accent = accentFor(name);
  const initial = firstInitial(label);
  const background = active
    ? `linear-gradient(135deg, color-mix(in srgb, ${accent} 85%, white 10%), color-mix(in srgb, ${accent} 95%, black 12%))`
    : `color-mix(in srgb, ${accent} 18%, transparent)`;
  return (
    <motion.span
      initial={false}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 380, damping: 25 }}
      className="inline-grid place-items-center rounded-full shrink-0 font-semibold transition"
      style={{
        width: size,
        height: size,
        background,
        color: active ? "#fff" : accent,
        fontSize: Math.round(size * 0.42),
        letterSpacing: "-0.02em",
        lineHeight: 1,
        boxShadow: active ? `0 0 12px -2px ${accent}` : "none",
      }}
      aria-label={label}
      title={label}
    >
      {initial}
    </motion.span>
  );
}
