// /dev/ui §4.13 — Interaction states (cross-cutting) (M4a-FU6 PR B + amend).
//
// Demonstrates every interaction state any interactive primitive
// (button, link, row, input, tab, nav item) must render correctly:
// default / hover / focus / selected / disabled / loading / error /
// success / reduced-motion. The reduced-motion rows demonstrate the
// pulse → static-dim downgrade rule per UI-GUIDELINES.md §9.
//
// PR B amend (visual polish):
//   - Uses the shared DemoButton primitive for every button example
//     so this section IS the canonical reference for button states.
//   - Reduced-motion row now compares pulse-on vs pulse-off
//     side-by-side via the same DemoCard wrapper, no inline CSS.

import DemoBadge from "@/app/dev/_lib/DemoBadge";
import DemoButton from "@/app/dev/_lib/DemoButton";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function InteractionStatesSection() {
  return (
    <Section
      anchor="interaction-states"
      number="4.13"
      title="Interaction states (cross-cutting)"
      fileOfRecord="every interactive primitive (DemoButton is the canonical reference)"
    >
      <StateRow label="default">
        <DemoButton variant="secondary">Test</DemoButton>
      </StateRow>
      <StateRow label="hover" note="bg + border shift to *-hot tokens">
        <DemoButton variant="secondary" hovered>Test</DemoButton>
      </StateRow>
      <StateRow label="focus" note="visible 2px ring (color-mix on --fg); AA contrast on dark bg">
        <DemoButton variant="secondary" focused>Test</DemoButton>
      </StateRow>
      <StateRow label="selected / current" note="same look as hover for tabs/nav; for forms it carries a stronger fill">
        <DemoButton variant="secondary" selected>Test</DemoButton>
      </StateRow>
      <StateRow label="disabled" note="aria-disabled; opacity reduced; no hover effect">
        <DemoButton variant="secondary" disabled>Test</DemoButton>
      </StateRow>
      <StateRow label="loading" note="—ing verb; trigger disabled">
        <DemoButton variant="secondary" loading>Testing…</DemoButton>
      </StateRow>
      <StateRow label="error" note="neutral inline message; no raw provider text">
        <div className="flex flex-col gap-1">
          <DemoButton variant="primary" size="md">Retry</DemoButton>
          <span className="text-[12px]" style={{ color: "var(--status-invalid)" }}>
            Could not reach the provider.
          </span>
        </div>
      </StateRow>
      <StateRow label="success" note="brief positive feedback via DemoBadge; or row highlight (§4.14)">
        <DemoBadge variant="status" color="var(--status-valid)">added</DemoBadge>
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-3 pb-1">
        Button variants — canonical reference
      </header>

      <StateRow label="primary" note="filled affirmative action; Add / Save">
        <DemoButton variant="primary" size="md">Add</DemoButton>
      </StateRow>
      <StateRow label="secondary" note="bordered surface; Test / Retry / Load models">
        <DemoButton variant="secondary" size="md">Test</DemoButton>
      </StateRow>
      <StateRow label="ghost" note="text-only with subtle hover bg; Cancel / Back-as-text fallback">
        <DemoButton variant="ghost" size="md">Cancel</DemoButton>
      </StateRow>
      <StateRow label="danger" note="filled --status-invalid; destructive (Delete, etc.)">
        <DemoButton variant="danger" size="md">Delete</DemoButton>
      </StateRow>
      <StateRow label="icon-only" note="28×28 square; aria-label mandatory">
        <DemoButton variant="icon" ariaLabel="Close">×</DemoButton>
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-3 pb-1">
        Reduced-motion demonstrations
      </header>

      <StateRow
        label="pulse — default"
        note="Tailwind animate-pulse via motion-safe; toggle prefers-reduced-motion to suppress"
      >
        <span
          className="inline-block w-2 h-2 rounded-full motion-safe:animate-pulse"
          style={{ background: "var(--status-live)" }}
        />
      </StateRow>

      <StateRow
        label="pulse — reduced motion"
        note="motion-safe class is suppressed; opacity is static"
      >
        <span
          className="inline-block w-2 h-2 rounded-full opacity-70"
          style={{ background: "var(--status-live)" }}
        />
      </StateRow>

      <StateRow label="highlight ring — default" note="3-second ring + pulse on a fresh add (PR #34)">
        <DemoCard pulse />
      </StateRow>

      <StateRow label="highlight ring — reduced motion" note="static ring; no pulse; same 3s window">
        <DemoCard pulse={false} />
      </StateRow>

      <StateRow label="modal transition" note="downgrade to instant show/hide under prefers-reduced-motion">
        <p className="text-[12px] text-[var(--fg-dim)]">
          Modal entry/exit transitions downgrade to instant show/hide
          under <code>prefers-reduced-motion: reduce</code>.
        </p>
      </StateRow>

      <StateRow label="card hover lift" note="kept (discrete 1px transform, not a continuous animation)">
        <p className="text-[12px] text-[var(--fg-dim)]">
          The 1px lift on card hover is a discrete state change, not a
          continuous animation — it stays even under reduced motion.
        </p>
      </StateRow>
    </Section>
  );
}

function DemoCard({ pulse }: { pulse: boolean }) {
  return (
    <div
      className={
        "panel p-4 w-[280px] text-[12px] text-[var(--fg-dim)] ring-2"
        + (pulse ? " motion-safe:animate-pulse" : "")
      }
      style={{
        borderColor: "var(--panel-border)",
        ["--tw-ring-color" as never]: "var(--status-valid)",
      }}
    >
      Fresh connector row — highlighted for 3s after add.
    </div>
  );
}
