// Shared canonical badge for /dev/ui examples (M4a-FU6 PR B amend).
//
// Two distinct visual families — see UI-GUIDELINES.md §3.5 / §3.7 /
// §4 for the contract:
//
//   "status"  — rounded-FULL pill. Carries a colored dot (live signal
//               cue) + tinted background + colored text + matching
//               border. Used for: Mission Control health (live / busy
//               / degraded / offline / unknown) AND connector-test
//               outcomes (valid / invalid / unreachable /
//               misconfigured / test-unknown).
//
//   "trust"   — rounded-SQ (3px) outlined chip. NO dot, NO background
//               fill — just colored text + thin matching border. Used
//               for connector provenance (first-party / community /
//               untrusted / unknown). The shape difference (pill vs
//               chip) is the visual cue that trust ≠ status even when
//               the colors overlap.
//
//   "meta"    — neutral chip; --fg-dimmer text + a soft border. Used
//               for "not tested" and similar absence-of-data states.
//
// The tinted backgrounds use CSS `color-mix(in srgb, X 12%, transparent)`
// so the pill subtly carries its tone without competing with the
// page's dark surface. Falls back to a transparent background on the
// rare browser that lacks color-mix (the pill's text + dot still read).

import type { ReactNode } from "react";

export type DemoBadgeVariant = "status" | "trust" | "meta";

interface Props {
  children: ReactNode;
  variant: DemoBadgeVariant;
  /** Required for "status" + "trust" — the CSS variable reference
   *  for the tone (e.g. "var(--status-valid)", "var(--trust-first-party)").
   *  Ignored for "meta". */
  color?: string;
  /** Show the leading dot. Default: true for "status", false for
   *  "trust" / "meta". The dot is what visually distinguishes a
   *  status pill from a trust chip beyond shape. */
  dot?: boolean;
}

export default function DemoBadge({
  children,
  variant,
  color,
  dot,
}: Props) {
  if (variant === "meta") {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] uppercase tracking-wider w-fit"
        style={{
          color: "var(--fg-dimmer)",
          border: "1px solid var(--panel-border)",
          background: "transparent",
        }}
      >
        {children}
      </span>
    );
  }

  if (variant === "trust") {
    // Trust = provenance. Outlined chip; rounded-[3px]; no dot, no fill.
    const c = color ?? "var(--trust-unknown)";
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] uppercase tracking-wider w-fit"
        style={{
          color: c,
          border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
          background: "transparent",
          letterSpacing: "0.08em",
        }}
      >
        {children}
      </span>
    );
  }

  // Status = active state. Rounded-full pill; tinted bg; dot by default.
  const c = color ?? "var(--status-unknown)";
  const showDot = dot ?? true;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider w-fit"
      style={{
        color: c,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 28%, transparent)`,
      }}
    >
      {showDot && (
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: c }}
        />
      )}
      {children}
    </span>
  );
}
