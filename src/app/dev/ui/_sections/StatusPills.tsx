// /dev/ui §4.8 — Status pills (canonical pill catalog) (M4a-FU6 PR B + amend).
//
// Two pill FAMILIES:
//
//   1. Mission Control family — renders the existing
//      src/components/Pill.tsx component directly (it's exported).
//      Tones: live / busy / degraded / offline / unknown / info.
//
//   2. Connector-test family — hand-mirror via the shared DemoBadge
//      "status" variant. Tokens: --status-valid / --status-invalid /
//      --status-unreachable / --status-misconfigured /
//      --status-test-unknown. The "not tested" state uses the
//      "meta" variant (no dot, neutral grey).
//
// Side-by-side rendering makes the semantic distinction documented
// in UI-GUIDELINES.md §3.6 ("Why two 'unknown' tokens?") visible:
// Mission Control "unknown" is GREY (silent); connector-test
// "unknown" is YELLOW (warning).

import Pill from "@/components/Pill";
import DemoBadge from "@/app/dev/_lib/DemoBadge";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function StatusPillsSection() {
  return (
    <Section
      anchor="status-pills"
      number="4.8"
      title="Status pills (canonical)"
      fileOfRecord="src/components/Pill.tsx (Mission Control) + ConnectorsPanel.StatusPill inline (connector-test)"
    >
      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-1">
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

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-3 pb-1">
        Connector-test family — DemoBadge "status" variant
      </header>

      <StateRow label="valid" note="--status-valid (alias of --status-live)">
        <DemoBadge variant="status" color="var(--status-valid)">valid</DemoBadge>
      </StateRow>
      <StateRow label="invalid" note="--status-invalid (red, softer than --status-offline)">
        <DemoBadge variant="status" color="var(--status-invalid)">invalid</DemoBadge>
      </StateRow>
      <StateRow label="unreachable" note="--status-unreachable (aliased to --status-invalid today)">
        <DemoBadge variant="status" color="var(--status-unreachable)">unreachable</DemoBadge>
      </StateRow>
      <StateRow label="misconfigured" note="--status-misconfigured (aliased to --status-invalid today)">
        <DemoBadge variant="status" color="var(--status-misconfigured)">misconfigured</DemoBadge>
      </StateRow>
      <StateRow label="unknown" note="--status-test-unknown (YELLOW). Semantically distinct from Mission Control's grey 'unknown'.">
        <DemoBadge variant="status" color="var(--status-test-unknown)">unknown</DemoBadge>
      </StateRow>
      <StateRow label="not tested" note="DemoBadge 'meta' variant. No dot, neutral grey border.">
        <DemoBadge variant="meta">not tested</DemoBadge>
      </StateRow>
    </Section>
  );
}
