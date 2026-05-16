// Status pill. Inline-style sets the color (CSS var or hex) and the
// `.pill` class handles geometry/spacing.

import type { CSSProperties, ReactNode } from "react";

export type PillTone = "live" | "busy" | "degraded" | "offline" | "unknown" | "info";

const TONE_COLOR: Record<PillTone, string> = {
  live: "var(--status-live)",
  busy: "var(--status-busy)",
  degraded: "var(--status-degraded)",
  offline: "var(--status-offline)",
  unknown: "var(--status-unknown)",
  info: "var(--fg-dim)",
};

export default function Pill({
  tone = "unknown",
  pulse = false,
  children,
  style,
}: {
  tone?: PillTone;
  pulse?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const color = TONE_COLOR[tone];
  return (
    <span className="pill" style={{ color, ...style }}>
      <span className={`tick${pulse ? " live" : ""}`} />
      {children}
    </span>
  );
}
