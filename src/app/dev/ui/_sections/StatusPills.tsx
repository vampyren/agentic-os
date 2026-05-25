// /dev/ui §4.8 — Status pills (canonical pill catalog) (M4a-FU6 PR B).
//
// Two pill FAMILIES:
//
//   1. Mission Control family — renders the existing
//      src/components/Pill.tsx component directly (it's exported).
//      Tones: live / busy / degraded / offline / unknown / info.
//
//   2. Connector-test family — hand-mirror of ConnectorsPanel's inline
//      StatusPill. Tokens: --status-valid / --status-invalid /
//      --status-unreachable / --status-misconfigured /
//      --status-test-unknown / --status-not-tested.
//
// Both families render side-by-side here so a contributor can see the
// semantic distinction documented in UI-GUIDELINES.md §3.6 ("Why two
// 'unknown' tokens?"): Mission Control "unknown" is GREY (silent);
// connector-test "unknown" is YELLOW (warning).

import Pill from "@/components/Pill";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function StatusPillsSection() {
  return (
    <Section
      anchor="status-pills"
      number="4.8"
      title="Status pills (canonical)"
      fileOfRecord="src/components/Pill.tsx (Mission Control family) + ConnectorsPanel.StatusPill inline (connector-test family)"
    >
      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-2">
        Mission Control family — <code>src/components/Pill.tsx</code>
      </header>

      <StateRow label="live" note="--status-live (green)">
        <Pill tone="live">live</Pill>
      </StateRow>
      <StateRow label="busy" note="--status-busy (cyan)">
        <Pill tone="busy">busy</Pill>
      </StateRow>
      <StateRow label="degraded" note="--status-degraded (amber)">
        <Pill tone="degraded">degraded</Pill>
      </StateRow>
      <StateRow label="offline" note="--status-offline (rose)">
        <Pill tone="offline">offline</Pill>
      </StateRow>
      <StateRow label="unknown" note="--status-unknown (GREY — Mission Control 'no signal')">
        <Pill tone="unknown">unknown</Pill>
      </StateRow>
      <StateRow label="info" note="neutral; not a status">
        <Pill tone="info">info</Pill>
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-4 pb-1">
        Connector-test family — hand-mirror; see also §4.7
      </header>

      <StateRow label="valid" note="--status-valid (alias of --status-live)">
        <DemoTestPill status="valid" />
      </StateRow>
      <StateRow label="invalid" note="--status-invalid (red, softer than --status-offline)">
        <DemoTestPill status="invalid" />
      </StateRow>
      <StateRow label="unreachable" note="--status-unreachable (aliased to --status-invalid today)">
        <DemoTestPill status="unreachable" />
      </StateRow>
      <StateRow label="misconfigured" note="--status-misconfigured (aliased to --status-invalid today)">
        <DemoTestPill status="misconfigured" />
      </StateRow>
      <StateRow label="unknown" note="--status-test-unknown (YELLOW). Semantically distinct from Mission Control's grey 'unknown'.">
        <DemoTestPill status="unknown" />
      </StateRow>
      <StateRow label="not tested" note="--status-not-tested (= --fg-dimmer). No dot.">
        <DemoTestPill status="not tested" />
      </StateRow>
    </Section>
  );
}

/** Hand-mirror of ConnectorsPanel.StatusPill — connector-test family
 *  only. The "not tested" branch renders without a dot. */
function DemoTestPill({
  status,
}: {
  status:
    | "valid"
    | "invalid"
    | "unreachable"
    | "misconfigured"
    | "unknown"
    | "not tested";
}) {
  if (status === "not tested") {
    return (
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--status-not-tested)" }}
      >
        not tested
      </span>
    );
  }
  const color =
    status === "valid"
      ? "var(--status-valid)"
      : status === "unknown"
      ? "var(--status-test-unknown)"
      : status === "unreachable"
      ? "var(--status-unreachable)"
      : status === "misconfigured"
      ? "var(--status-misconfigured)"
      : "var(--status-invalid)";
  return (
    <span
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider w-fit"
      style={{ color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}
