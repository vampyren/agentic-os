// /dev/ui §4.9 — Trust badges (M4a-FU6 PR B + amend).
//
// Hand-mirror of the TRUST_COLORS surface in
// src/app/settings/_connectors/ConnectorsPanel.tsx. Trust is
// PROVENANCE (where did this connector come from), NOT validation
// status.
//
// PR B amend (visual polish):
//   - Renders via the shared DemoBadge "trust" variant — outlined
//     rounded-square chip, NO dot, NO bg fill. The shape difference
//     vs §4.8's rounded-full status pills is the visual cue that
//     trust ≠ status even when the colors overlap.

import DemoBadge from "@/app/dev/_lib/DemoBadge";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

const TRUST_TOKEN = {
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
        <DemoBadge variant="trust" color={TRUST_TOKEN["first-party"]}>first-party</DemoBadge>
      </StateRow>
      <StateRow label="community" note="loaded from ~/.agentic-os/presets/; --trust-community (amber)">
        <DemoBadge variant="trust" color={TRUST_TOKEN.community}>community</DemoBadge>
      </StateRow>
      <StateRow label="untrusted" note="operator-flagged; --trust-untrusted (red). NOT 'failed validation'.">
        <DemoBadge variant="trust" color={TRUST_TOKEN.untrusted}>untrusted</DemoBadge>
      </StateRow>
      <StateRow label="unknown" note="provenance unresolved; --trust-unknown (grey)">
        <DemoBadge variant="trust" color={TRUST_TOKEN.unknown}>unknown</DemoBadge>
      </StateRow>

      <StateRow label="in context" note="trust chip on the LEFT next to the connectorId — opposite side from the status pill">
        <div className="flex items-center gap-2 text-[14px]">
          <span className="font-medium">openai-live</span>
          <DemoBadge variant="trust" color={TRUST_TOKEN["first-party"]}>first-party</DemoBadge>
        </div>
      </StateRow>

      <StateRow label="trust vs status — side by side" note="rounded-square chip vs rounded-full pill — the shape difference IS the family signal">
        <div className="flex items-center gap-3">
          <DemoBadge variant="trust" color={TRUST_TOKEN["first-party"]}>first-party</DemoBadge>
          <span className="text-[10px] text-[var(--fg-dimmer)]">vs</span>
          <DemoBadge variant="status" color="var(--status-valid)">valid</DemoBadge>
        </div>
      </StateRow>
    </Section>
  );
}
