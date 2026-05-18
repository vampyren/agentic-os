"use client";

import { accentFor } from "@/lib/accent";

interface Props {
  /** Manifest name (used for accent + initial). */
  name: string;
  /** Optional display name; falls back to `name`. */
  displayName?: string;
  /** Pixel size of the circular tile. */
  size?: number;
  /** When true, renders the saturated active-state gradient + glow. */
  active?: boolean;
}

function firstInitial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Runtime-agnostic agent identity glyph. Renders a circular accent-tinted
 * tile with the agent's first initial. Works for any agent the registry
 * loads — no hardcoded list, no image assets. The accent comes from
 * `accentFor()` so new agents without a known accent still get a stable
 * hash-mapped colour.
 *
 * `active` lifts the saturation: full gradient fill + glow ring, white
 * letter. Inactive uses a soft accent wash with the letter in accent.
 */
export default function AgentAvatar({ name, displayName, size = 22, active = false }: Props) {
  const accent = accentFor(name);
  const label = displayName ?? name;
  const initial = firstInitial(label);

  const background = active
    ? `linear-gradient(135deg, color-mix(in srgb, ${accent} 85%, white 10%), color-mix(in srgb, ${accent} 95%, black 12%))`
    : `color-mix(in srgb, ${accent} 18%, transparent)`;

  return (
    <span
      className="inline-grid place-items-center rounded-full shrink-0 font-semibold transition"
      style={{
        width: size,
        height: size,
        background,
        color: active ? "#fff" : accent,
        fontSize: Math.round(size * 0.46),
        letterSpacing: "-0.02em",
        lineHeight: 1,
        boxShadow: active ? `0 0 12px -2px ${accent}` : "none",
      }}
      aria-hidden="true"
      title={label}
    >
      {initial}
    </span>
  );
}
