"use client";

// Settings page (M4a — PR3c).
//
// Two sections active in M4a: Features (read-only, M2) and Connectors
// (M4a-3c). Permissions / Vault / Advanced remain disabled — they fill in
// with later milestones; the rail layout is final.

import { useState } from "react";
import { useFeatures } from "@/app/_components/FeaturesProvider";
import {
  featureSettingsRows,
  type SettingsRow,
} from "@/app/_lib/shellSelectors";
import { settingsComponentFor } from "@/app/_components/componentRegistry";
import { ConnectorsPanel } from "./_connectors/ConnectorsPanel";

type SectionKey = "features" | "connectors" | "permissions" | "vault" | "advanced";

const RAIL: { key: SectionKey; label: string; active: boolean }[] = [
  { key: "features",    label: "Features",    active: true  },
  { key: "connectors",  label: "Connectors",  active: true  },
  { key: "permissions", label: "Permissions", active: false },
  { key: "vault",       label: "Vault",       active: false },
  { key: "advanced",    label: "Advanced",    active: false },
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

function FeaturesSection() {
  const rows = featureSettingsRows(useFeatures());
  return (
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
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<SectionKey>("features");

  return (
    <div className="mt-6 flex gap-6">
      <nav className="w-[150px] shrink-0 flex flex-col gap-1">
        {RAIL.map((item) => {
          const selected = section === item.key;
          if (!item.active) {
            return (
              <div
                key={item.key}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px]"
                style={{
                  background: "transparent",
                  color: "var(--fg-dimmer)",
                }}
              >
                <span>{item.label}</span>
                <span className="text-[9px] uppercase tracking-wider">soon</span>
              </div>
            );
          }
          return (
            <button
              type="button"
              key={item.key}
              onClick={() => setSection(item.key)}
              className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px] text-left"
              style={{
                background: selected ? "var(--panel)" : "transparent",
                color: selected ? "var(--fg)" : "var(--fg-dim)",
                cursor: "pointer",
              }}
            >
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {section === "features" && <FeaturesSection />}
      {section === "connectors" && <ConnectorsPanel />}
    </div>
  );
}
