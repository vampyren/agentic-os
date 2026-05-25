// /dev/ui §4.9 — Trust badges (M4a-FU6 PR B).
//
// Hand-mirror of the TRUST_COLORS surface in
// src/app/settings/_connectors/ConnectorsPanel.tsx. Trust is
// PROVENANCE (where did this connector come from), NOT validation
// status. Trust badges live in the row's LEFT column next to the
// connectorId; status pills live on the right. The two families
// (--trust-* vs --status-*) stay conceptually separate per
// UI-GUIDELINES.md §2 + §3.7 even where hex values overlap today.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

const TRUST_COLOR = {
  "first-party": "var(--trust-first-party)",
  community: "var(--trust-community)",
  untrusted: "var(--trust-untrusted)",
  unknown: "var(--trust-unknown)",
} as const;

export default function TrustBadgesSection() {
  return (
    <Section
      anchor="trust-badges"
      number="4.9"
      title="Trust badges"
      fileOfRecord="src/app/settings/_connectors/ConnectorsPanel.tsx (TRUST_COLORS)"
    >
      <StateRow label="first-party" note="ships with the binary; --trust-first-party (green)">
        <DemoTrustBadge level="first-party" />
      </StateRow>
      <StateRow label="community" note="loaded from ~/.agentic-os/presets/; --trust-community (amber)">
        <DemoTrustBadge level="community" />
      </StateRow>
      <StateRow label="untrusted" note="operator-flagged; --trust-untrusted (red). NOT 'failed validation'.">
        <DemoTrustBadge level="untrusted" />
      </StateRow>
      <StateRow label="unknown" note="provenance unresolved; --trust-unknown (grey)">
        <DemoTrustBadge level="unknown" />
      </StateRow>

      <StateRow label="in context" note="how the badge renders alongside a connectorId — left column">
        <div className="flex items-center gap-2 text-[14px]">
          <span className="font-medium">openai-live</span>
          <DemoTrustBadge level="first-party" />
        </div>
      </StateRow>
    </Section>
  );
}

function DemoTrustBadge({
  level,
}: {
  level: keyof typeof TRUST_COLOR;
}) {
  return (
    <span
      className="text-[10px] uppercase tracking-wider w-fit"
      style={{ color: TRUST_COLOR[level] }}
    >
      {level}
    </span>
  );
}
