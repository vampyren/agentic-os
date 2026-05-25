// /dev/ui §4.6 — Settings layout (M4a-FU6 PR B).
//
// Hand-mirror of the left-rail + section-panel layout from
// src/app/settings/page.tsx. The actual settings page uses
// usePathname / useRouter for the `?section=…` URL-param pattern
// (PR #34); this demo is static — each state is rendered side by side
// rather than toggled by interaction.

import StateRow, { Section } from "@/app/dev/_lib/StateRow";

export default function SettingsLayoutSection() {
  return (
    <Section
      anchor="settings-layout"
      number="4.6"
      title="Settings layout"
      fileOfRecord="src/app/settings/page.tsx"
    >
      <StateRow label="left-rail section" note="full rail with idle / active / soon items + section panel">
        <div className="grid grid-cols-[160px_1fr] gap-4 w-full max-w-[640px]">
          <nav className="flex flex-col gap-1">
            <RailItem label="Connectors" active />
            <RailItem label="Features" />
            <RailItem label="Vault" />
            <RailItem label="Approvals" soon />
            <RailItem label="Secrets" soon />
          </nav>
          <div
            className="panel p-4 min-h-[160px]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <div className="text-[12px] uppercase tracking-wider text-[var(--fg-dimmer)]">
              Section panel
            </div>
            <p className="text-[12px] text-[var(--fg-dim)] mt-2">
              The active rail item drives which section panel renders here.
              Refresh preserves the current section via{" "}
              <code className="text-[var(--fg-dim)]">?section=…</code> (PR #34).
            </p>
          </div>
        </div>
      </StateRow>

      <StateRow label="rail item — idle">
        <div className="w-[160px]">
          <RailItem label="Features" />
        </div>
      </StateRow>

      <StateRow label="rail item — active" note="distinct from hover; visible at-a-glance">
        <div className="w-[160px]">
          <RailItem label="Connectors" active />
        </div>
      </StateRow>

      <StateRow label="rail item — soon" note="dimmed AND non-clickable; tooltip on hover (not shown in static demo)">
        <div className="w-[160px]">
          <RailItem label="Approvals" soon />
        </div>
      </StateRow>
    </Section>
  );
}

function RailItem({
  label,
  active = false,
  soon = false,
}: {
  label: string;
  active?: boolean;
  soon?: boolean;
}) {
  return (
    <div
      aria-disabled={soon || undefined}
      className="px-3 py-1.5 rounded-md text-[13px] border"
      style={{
        borderColor: active ? "var(--panel-border-hot)" : "transparent",
        background: active ? "var(--bg-elevated-hot)" : "transparent",
        color: soon ? "var(--fg-dimmer)" : active ? "var(--fg)" : "var(--fg-dim)",
        opacity: soon ? 0.7 : 1,
      }}
    >
      <span className="flex items-center justify-between">
        {label}
        {soon && (
          <span className="text-[9px] uppercase tracking-wider opacity-70">
            soon
          </span>
        )}
      </span>
    </div>
  );
}
