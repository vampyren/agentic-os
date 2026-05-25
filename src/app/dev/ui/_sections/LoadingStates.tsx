// /dev/ui §4.12 — Loading / skeleton states (M4a-FU6 PR B + amend).
//
// Demonstrates the canonical loading visuals: button labels that
// flip to "—ing" verbs (Loading / Testing / Saving), skeleton bars
// that pulse, and full-card skeletons. All pulses respect
// `prefers-reduced-motion: reduce` via Tailwind's `motion-safe:`
// modifier — under reduced motion the pulse drops to static
// dimming.
//
// PR B amend: button examples use the shared DemoButton primitive so
// they look like the same family as every other button on /dev/ui.

import DemoButton from "@/app/dev/_lib/DemoButton";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function LoadingStatesSection() {
  return (
    <Section
      anchor="loading-states"
      number="4.12"
      title="Loading / skeleton states"
      fileOfRecord="various (ModelPicker.tsx, ConnectorsPanel.tsx, AddProviderFlow.tsx)"
    >
      <StateRow label="button — Loading…" note="ModelPicker's Load-models pattern (PR #30)">
        <DemoButton variant="secondary" loading>Loading…</DemoButton>
      </StateRow>
      <StateRow label="button — Testing…" note="ConnectorsPanel.tsx — Test flow">
        <DemoButton variant="secondary" loading>Testing…</DemoButton>
      </StateRow>
      <StateRow label="button — Saving…" note="future Save flows">
        <DemoButton variant="primary" size="md" loading>Saving…</DemoButton>
      </StateRow>

      <StateRow
        label="bar skeleton (default)"
        note="opacity 0.5 → 1 → 0.5 at 1.5s cadence (Tailwind animate-pulse)"
      >
        <DemoBarSkeleton lines={3} />
      </StateRow>

      <StateRow
        label="bar skeleton (reduced motion)"
        note="manually showing the static fallback (no animate-pulse)"
      >
        <DemoBarSkeleton lines={3} forceStatic />
      </StateRow>

      <StateRow label="card skeleton" note="placeholder for a connector row mid-add">
        <div
          className="panel p-4 w-[420px] flex flex-col gap-2 motion-safe:animate-pulse"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <span
            className="block h-3 rounded"
            style={{ background: "var(--bg-elevated-hot)", width: "40%" }}
          />
          <span
            className="block h-2 rounded"
            style={{ background: "var(--bg-elevated-hot)", width: "65%" }}
          />
          <span
            className="block h-2 rounded"
            style={{ background: "var(--bg-elevated-hot)", width: "30%" }}
          />
        </div>
      </StateRow>

      <StateRow label="picker — Loading…" note="ModelPicker mid-fetch; manual entry still available">
        <div
          className="rounded-md border px-3 py-2 w-[320px] text-[12px] text-[var(--fg-dim)] motion-safe:animate-pulse"
          style={{ borderColor: "var(--panel-border)" }}
        >
          Loading models from provider…
        </div>
      </StateRow>
    </Section>
  );
}

function DemoBarSkeleton({
  lines,
  forceStatic = false,
}: {
  lines: number;
  forceStatic?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 w-[320px]">
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className={
            "block h-2 rounded"
            + (forceStatic ? "" : " motion-safe:animate-pulse")
          }
          style={{
            background: "var(--bg-elevated-hot)",
            width: `${100 - i * 18}%`,
            opacity: forceStatic ? 0.6 : 1,
          }}
        />
      ))}
    </div>
  );
}
