// /dev/ui §4.2 — Mission Control top status cards (M4a-FU6 PR B).
//
// Hand-mirror of the Tile shape from src/components/Vitals.tsx.
// Vitals.tsx polls /api/vitals every 4s and renders a live grid;
// importing it here would violate the /dev/ui mock-data rule
// (§3.4 — no live API calls). Hand-mirror reproduces the shape
// against fixture inputs.
//
// Tokens used: --status-live / --status-busy / --status-degraded /
// --status-offline / --status-unknown (existing Mission Control
// family). NOTE: --status-unknown stays GREY here; the connector-test
// "unknown" yellow lives under --status-test-unknown and surfaces on
// §4.7 / §4.8 only.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function MissionControlCardsSection() {
  return (
    <Section
      anchor="mission-control-cards"
      number="4.2"
      title="Mission Control top status cards"
      fileOfRecord="src/components/Vitals.tsx + src/app/page.tsx"
      kind="hand-mirror"
    >
      <StateRow label="live" note="service up; --status-live (green) with soft glow">
        <DemoTile label="Vault" primary="ready" tone="live" />
      </StateRow>
      <StateRow label="busy" note="a run is in progress; --status-busy (cyan)">
        <DemoTile label="Scheduler" primary="running" tone="busy" />
      </StateRow>
      <StateRow label="degraded" note="--status-degraded (amber)">
        <DemoTile label="Connectors" primary="2 of 3 healthy" tone="degraded" />
      </StateRow>
      <StateRow label="offline" note="--status-offline (rose)">
        <DemoTile label="Hermes" primary="unreachable" tone="offline" />
      </StateRow>
      <StateRow label="unknown" note="no data signal; --status-unknown (GREY — silent, do not alarm)">
        <DemoTile label="Memory" primary="—" tone="unknown" />
      </StateRow>
      <StateRow label="info-only" note="card without a tracked signal">
        <DemoTile label="Build" primary="v0.3.0" tone="info" />
      </StateRow>
    </Section>
  );
}

/** Hand-mirror of the Tile shape from src/components/Vitals.tsx. */
function DemoTile({
  label,
  primary,
  tone,
}: {
  label: string;
  primary: string;
  tone: "live" | "busy" | "degraded" | "offline" | "unknown" | "info";
}) {
  const toneColor =
    tone === "live"
      ? "var(--status-live)"
      : tone === "busy"
      ? "var(--status-busy)"
      : tone === "degraded"
      ? "var(--status-degraded)"
      : tone === "offline"
      ? "var(--status-offline)"
      : tone === "unknown"
      ? "var(--status-unknown)"
      : "var(--fg-dim)";

  return (
    <div
      className="panel p-4 w-[220px] flex flex-col gap-2 relative overflow-hidden"
      style={{ borderColor: "var(--panel-border)" }}
    >
      {/* Soft glow only for live tone. References --shadow-glow via
          currentColor — same pattern as Vitals.tsx. */}
      {tone === "live" && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full blur-3xl opacity-30"
          style={{ background: toneColor }}
        />
      )}
      <div className="flex items-start justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--fg-dimmer)]">
          {label}
        </span>
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: toneColor }}
        />
      </div>
      <span className="text-[18px] font-medium" style={{ color: "var(--fg)" }}>
        {primary}
      </span>
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: toneColor }}
      >
        {tone}
      </span>
    </div>
  );
}
