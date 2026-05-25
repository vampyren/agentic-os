// /dev/ui §4.13 — Interaction states (cross-cutting) (M4a-FU6 PR B).
//
// Demonstrates every interaction state that any interactive primitive
// (button, link, row, input, tab, nav item) must render correctly:
// default / hover / focus / selected / disabled / loading / error /
// success / reduced-motion. The reduced-motion row demonstrates the
// pulse → static-dim downgrade rule per UI-GUIDELINES.md §9.
//
// Each state is rendered as its own visual demo (not toggled by
// interaction) so a reviewer can compare side-by-side.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function InteractionStatesSection() {
  return (
    <Section
      anchor="interaction-states"
      number="4.13"
      title="Interaction states (cross-cutting)"
      fileOfRecord="every interactive primitive"
    >
      <StateRow label="default">
        <DemoButton label="Test" />
      </StateRow>
      <StateRow label="hover" note="border-opacity bump; matches Sidebar / ConnectorRow conventions">
        <DemoButton label="Test" hovered />
      </StateRow>
      <StateRow label="focus" note="visible ring; AA contrast on the bg; --panel-border-hot">
        <DemoButton label="Test" focused />
      </StateRow>
      <StateRow label="selected / current" note="distinct from hover">
        <DemoButton label="Test" selected />
      </StateRow>
      <StateRow label="disabled" note="aria-disabled; opacity reduced; no hover effect">
        <DemoButton label="Test" disabled />
      </StateRow>
      <StateRow label="loading" note="—ing verb; trigger disabled">
        <DemoButton label="Testing…" disabled />
      </StateRow>
      <StateRow label="error" note="neutral inline message; no raw provider text">
        <div className="flex flex-col gap-1">
          <DemoButton label="Retry" />
          <span className="text-[12px]" style={{ color: "var(--status-invalid)" }}>
            Could not reach the provider.
          </span>
        </div>
      </StateRow>
      <StateRow label="success" note="brief positive feedback; or row highlight (§4.14)">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--status-valid)" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--status-valid)" }} />
          Added.
        </div>
      </StateRow>

      <header className="text-[11px] uppercase tracking-wider text-[var(--fg-dim)] pt-4 pb-1">
        Reduced-motion demonstrations
      </header>

      <StateRow
        label="pulse — default"
        note="Tailwind animate-pulse; smooth opacity sweep. Toggle prefers-reduced-motion in devtools to verify the static fallback below."
      >
        <span
          className="inline-block w-2 h-2 rounded-full motion-safe:animate-pulse"
          style={{ background: "var(--status-live)" }}
        />
      </StateRow>

      <StateRow
        label="pulse — reduced motion"
        note="motion-safe:animate-pulse class is dropped; opacity is static"
      >
        <span
          className="inline-block w-2 h-2 rounded-full opacity-70"
          style={{ background: "var(--status-live)" }}
        />
      </StateRow>

      <StateRow
        label="highlight ring — default"
        note="3-second ring + pulse on a fresh connector add (PR #34)"
      >
        <DemoCard pulse />
      </StateRow>

      <StateRow
        label="highlight ring — reduced motion"
        note="static border-color; same 3s window; no pulse"
      >
        <DemoCard pulse={false} />
      </StateRow>

      <StateRow
        label="modal transition"
        note="under reduced motion, modals show/hide instantly (no fade)"
      >
        <p className="text-[12px] text-[var(--fg-dim)]">
          Modal entry/exit transitions downgrade to instant show/hide
          under <code>prefers-reduced-motion: reduce</code>.
        </p>
      </StateRow>

      <StateRow
        label="card hover lift"
        note="kept under reduced motion (discrete 1px transform, not a continuous animation)"
      >
        <p className="text-[12px] text-[var(--fg-dim)]">
          The 1px lift on card hover is a discrete state change, not a
          continuous animation — it stays even under reduced motion.
        </p>
      </StateRow>
    </Section>
  );
}

function DemoButton({
  label,
  hovered = false,
  focused = false,
  selected = false,
  disabled = false,
}: {
  label: string;
  hovered?: boolean;
  focused?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  const opacity = disabled ? 0.5 : 1;
  const borderColor =
    selected || focused || hovered
      ? "var(--panel-border-hot)"
      : "var(--panel-border)";
  const bg = selected ? "var(--bg-elevated-hot)" : "transparent";
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className="px-3 py-1.5 text-[12px] rounded-md border cursor-default"
      style={{
        borderColor,
        background: bg,
        opacity,
        boxShadow: focused ? "0 0 0 2px rgba(255,255,255,0.06)" : "none",
      }}
    >
      {label}
    </button>
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
