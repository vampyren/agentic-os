// /dev/ui §4.6 — Settings layout (M4a-FU6 PR B + amend).
//
// Hand-mirror of the left-rail + section-panel layout from
// src/app/settings/page.tsx. The actual settings page uses
// usePathname / useRouter for the `?section=…` URL-param pattern
// (PR #34); this demo is static — each state is rendered side by
// side rather than toggled by interaction.
//
// PR B amend (visual polish):
//   - Rail items now look like polished tabs: subtle elevated
//     surface for idle; obviously filled + accent-edged for
//     selected; clearly dimmed for "soon".
//   - The accent left-edge on the active rail item is the same cue
//     used by §4.1 sidebar items — consistent "this is current"
//     language across the app.

import { ChevronRight } from "lucide-react";
import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function SettingsLayoutSection() {
  return (
    <Section
      anchor="settings-layout"
      number="4.6"
      title="Settings layout"
      fileOfRecord="src/app/settings/page.tsx"
      kind="hand-mirror"
    >
      <StateRow label="rail + section panel" note="full layout: nav rail on the left, active section panel on the right">
        <div className="grid grid-cols-[180px_1fr] gap-4 w-full max-w-[640px]">
          <nav className="flex flex-col gap-1.5">
            <RailItem label="Connectors" active />
            <RailItem label="Features" />
            <RailItem label="Vault" />
            <RailItem label="Approvals" soon />
            <RailItem label="Secrets" soon />
          </nav>
          <div
            className="rounded-md border p-4 min-h-[180px]"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--bg-elevated)",
            }}
          >
            <div className="text-[12px] uppercase tracking-wider text-[var(--fg-dimmer)] mb-2">
              Section panel · Connectors
            </div>
            <p className="text-[12px] text-[var(--fg-dim)]">
              The active rail item drives which section panel renders here.
              Refresh preserves the current section via{" "}
              <code>?section=…</code> (PR #34).
            </p>
          </div>
        </div>
      </StateRow>

      <StateRow label="rail item — idle">
        <div className="w-[180px]">
          <RailItem label="Features" />
        </div>
      </StateRow>

      <StateRow label="rail item — hover" note="border + bg shift to --panel-border-hot / --bg-elevated-hot">
        <div className="w-[180px]">
          <RailItem label="Features" hovered />
        </div>
      </StateRow>

      <StateRow label="rail item — selected" note="filled bg + accent left edge + bright text — unmissable">
        <div className="w-[180px]">
          <RailItem label="Connectors" active />
        </div>
      </StateRow>

      <StateRow label="rail item — soon" note="dimmed AND non-clickable; small 'soon' chip on the right">
        <div className="w-[180px]">
          <RailItem label="Approvals" soon />
        </div>
      </StateRow>
    </Section>
  );
}

function RailItem({
  label,
  active = false,
  hovered = false,
  soon = false,
}: {
  label: string;
  active?: boolean;
  hovered?: boolean;
  soon?: boolean;
}) {
  const isHot = active || hovered;
  return (
    <div
      aria-disabled={soon || undefined}
      className="relative inline-flex items-center justify-between gap-2 px-3 py-2 rounded-md border w-full"
      style={{
        borderColor: isHot
          ? "var(--panel-border-hot)"
          : "var(--panel-border)",
        background: active
          ? "var(--bg-elevated-hot)"
          : hovered
          ? "var(--bg-elevated-hot)"
          : "var(--bg-elevated)",
        color: soon
          ? "var(--fg-dimmer)"
          : active
          ? "var(--fg)"
          : "var(--fg-dim)",
        opacity: soon ? 0.65 : 1,
      }}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
          style={{ background: "var(--fg)" }}
        />
      )}
      <span className="text-[13px] truncate">{label}</span>
      {soon ? (
        <span
          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-[3px]"
          style={{
            color: "var(--fg-dimmer)",
            border: "1px solid var(--panel-border)",
            background: "transparent",
          }}
        >
          soon
        </span>
      ) : active ? (
        <ChevronRight size={12} aria-hidden style={{ color: "var(--fg-dim)" }} />
      ) : null}
    </div>
  );
}
