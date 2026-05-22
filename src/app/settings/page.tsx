"use client";

// Settings page (Phase 1C — M2).
//
// Shell-owned page (not a feature, so no feature gate). M2 builds the
// Features section only — read-only: every registered feature with its
// lifecycle state, reasons, and its hand-built settings panel if it
// exposes one. The other rail sections (Connectors / Permissions /
// Vault / Advanced) are shown disabled — M4a onward fills them in, so
// the layout is final now.

import { useFeatures } from "@/app/_components/FeaturesProvider";
import {
  featureSettingsRows,
  type SettingsRow,
} from "@/app/_lib/shellSelectors";
import { settingsComponentFor } from "@/app/_components/componentRegistry";

const RAIL: { key: string; label: string; active: boolean }[] = [
  { key: "features", label: "Features", active: true },
  { key: "connectors", label: "Connectors", active: false },
  { key: "permissions", label: "Permissions", active: false },
  { key: "vault", label: "Vault", active: false },
  { key: "advanced", label: "Advanced", active: false },
];

const STATE_BADGE: Record<
  SettingsRow["state"],
  { label: string; color: string }
> = {
  ready: { label: "Ready", color: "#4ade80" },
  degraded: { label: "Degraded", color: "#fbbf24" },
  unavailable: { label: "Unavailable", color: "#f87171" },
  disabled: { label: "Disabled", color: "#8a8f98" },
};

function FeatureRow({ row }: { row: SettingsRow }) {
  const badge = STATE_BADGE[row.state];
  const Panel = row.settingsPanelKey
    ? settingsComponentFor(row.settingsPanelKey)
    : null;

  return (
    <div className="panel p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-medium">{row.title}</span>
        <span
          className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider"
          style={{ color: badge.color }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: badge.color }}
          />
          {badge.label}
        </span>
      </div>

      <p className="text-[13px] text-[var(--fg-dim)]">{row.description}</p>

      {row.reasons.length > 0 && (
        <ul className="flex flex-col gap-1">
          {row.reasons.map((r, i) => (
            <li
              key={`${r.code}-${i}`}
              className="text-[12px] text-[var(--fg-dimmer)]"
            >
              {r.message}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-[var(--fg-dimmer)]">
        {row.canDisable
          ? "Can be enabled/disabled in the operator config."
          : "Core feature — always on."}
      </p>

      {Panel && (
        <div className="pt-3 border-t border-[var(--panel-border)]">
          <Panel />
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const rows = featureSettingsRows(useFeatures());

  return (
    <div className="mt-6 flex gap-6">
      <nav className="w-[150px] shrink-0 flex flex-col gap-1">
        {RAIL.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px]"
            style={{
              background: item.active ? "var(--panel)" : "transparent",
              color: item.active ? "var(--fg)" : "var(--fg-dimmer)",
            }}
          >
            <span>{item.label}</span>
            {!item.active && (
              <span className="text-[9px] uppercase tracking-wider">soon</span>
            )}
          </div>
        ))}
      </nav>

      <section className="flex-1 min-w-0 flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">Features</h1>
          <p className="text-[13px] text-[var(--fg-dim)]">
            Every registered feature, its lifecycle state and reasons.
            Read-only — toggles land in a later milestone.
          </p>
        </header>

        {rows.length === 0 ? (
          <div className="panel p-8 text-center text-[13px] text-[var(--fg-dim)]">
            No features registered.
          </div>
        ) : (
          rows.map((row) => <FeatureRow key={row.id} row={row} />)
        )}
      </section>
    </div>
  );
}
