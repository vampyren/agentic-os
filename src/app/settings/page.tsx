"use client";

// Settings page (M4a — PR3c).
//
// Two sections active in M4a: Features (read-only, M2) and Connectors
// (M4a-3c). Permissions / Vault / Advanced remain disabled — they fill in
// with later milestones; the rail layout is final.
//
// Section state is mirrored to the URL as `?section=…` so a browser
// refresh keeps the operator on whatever section they were viewing.
// Live UI review (post-PR-#34-first-commit) hit this — refresh used to
// always snap back to "features" because the section lived in transient
// React state. ACTIVE_SECTIONS validates the param so a stale or
// hand-typed URL doesn't dump the operator on an empty/inactive section.

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFeatures } from "@/app/_components/FeaturesProvider";
import {
  featureSettingsRows,
  type SettingsRow,
} from "@/app/_lib/shellSelectors";
import { settingsComponentFor } from "@/app/_components/componentRegistry";
import { ConnectorsPanel } from "./_connectors/ConnectorsPanel";

type SectionKey = "features" | "connectors" | "permissions" | "vault" | "advanced";

const ACTIVE_SECTIONS = new Set<SectionKey>(["features", "connectors"]);

function isActiveSection(s: string | null): s is SectionKey {
  return s !== null && ACTIVE_SECTIONS.has(s as SectionKey);
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  // Initial section comes from the URL on first render so refresh /
  // direct-link to /settings?section=connectors lands correctly. Stale
  // / inactive section keys fall back to "features".
  const initialSection: SectionKey = isActiveSection(searchParams.get("section"))
    ? (searchParams.get("section") as SectionKey)
    : "features";
  const [section, setSection] = useState<SectionKey>(initialSection);

  // Selecting a section updates BOTH React state and the URL search
  // param so a subsequent refresh stays put. `router.replace` (not
  // `push`) keeps the back button useful — operators rarely want to
  // step back through their own tab-switches inside Settings.
  // `scroll: false` keeps the viewport where it is.
  const selectSection = useCallback(
    (key: SectionKey) => {
      setSection(key);
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", key);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

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
              onClick={() => selectSection(item.key)}
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
