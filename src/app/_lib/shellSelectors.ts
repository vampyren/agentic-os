// Shell selectors — registry-driven shell (Phase 1C — M2).
//
// All filter / sort / visibility logic for the registry-driven shell
// lives here as PURE, DOM-free functions. The shell's client
// components (Sidebar, CommandPalette, Mission Control, Settings) only
// RENDER the output of these selectors — they hold no exposure logic
// of their own. Keeping the logic here makes it unit-testable under
// Vitest without a React renderer (no jsdom / testing-library needed).
//
// Each selector takes the UI-safe feature list and an optional `deps`
// bag for the icon / component registries — same dependency-injection
// pattern as the kernel resolver, so tests inject fakes and production
// callers pass nothing.

import type { UiSafeFeature } from "@/kernel/features/projection";
import type {
  CommandExposure,
  FeatureLifecycleState,
  FeatureReason,
  NavExposure,
} from "@/kernel/features/types";
import { hasIcon } from "@/app/_components/iconRegistry";
import {
  hasCardComponent,
  hasSettingsComponent,
} from "@/app/_components/componentRegistry";

/** Registry probes the selectors need. Injected so tests stay pure. */
export interface ShellSelectorDeps {
  hasIcon: (key: string) => boolean;
  hasCardComponent: (key: string) => boolean;
  hasSettingsComponent: (key: string) => boolean;
}

const DEFAULT_DEPS: ShellSelectorDeps = {
  hasIcon,
  hasCardComponent,
  hasSettingsComponent,
};

// ── Render-ready shapes ─────────────────────────────────────────────
//
// Selectors return small render records, NOT raw exposures — the shell
// renders these directly.

export interface NavRenderItem {
  id: string;
  label: string;
  href: string;
  iconKey: string;
  order: number;
}

export interface CommandRenderItem {
  id: string;
  label: string;
  /** M2 supports navigate-only commands, so an href is always present. */
  href: string;
  keywords: string[];
}

export interface CardRenderItem {
  id: string;
  componentKey: string;
  order: number;
  span: 1 | 2;
}

export interface SettingsRow {
  id: string;
  title: string;
  description: string;
  state: FeatureLifecycleState;
  reasons: FeatureReason[];
  canDisable: boolean;
  /** Resolvable settings-panel componentKey, or null if none / unknown. */
  settingsPanelKey: string | null;
}

// ── Visibility rules (locked — M2 spec §9) ──────────────────────────

function navVisible(
  visibility: NavExposure["visibility"],
  state: FeatureLifecycleState,
): boolean {
  switch (visibility ?? "when-enabled") {
    case "always":
      return true;
    case "when-ready":
      return state === "ready";
    case "when-enabled":
    default:
      return state !== "disabled";
  }
}

function commandVisible(
  visibility: CommandExposure["visibility"],
  state: FeatureLifecycleState,
): boolean {
  switch (visibility ?? "when-ready") {
    case "always":
      return true;
    case "when-degraded-or-better":
      return state === "ready" || state === "degraded";
    case "when-ready":
    default:
      return state === "ready";
  }
}

// ── Selectors ───────────────────────────────────────────────────────

/**
 * Feature nav items the sidebar should render: visible per the nav
 * exposure's `visibility` rule, icon resolvable, sorted by `order`
 * (ties broken by `id`).
 */
export function visibleNavItems(
  features: readonly UiSafeFeature[],
  deps: ShellSelectorDeps = DEFAULT_DEPS,
): NavRenderItem[] {
  const items: NavRenderItem[] = [];
  for (const feature of features) {
    const state = feature.status.state;
    for (const nav of feature.exposures.nav ?? []) {
      if (!navVisible(nav.visibility, state)) continue;
      if (!deps.hasIcon(nav.iconKey)) continue;
      items.push({
        id: nav.id,
        label: nav.label,
        href: nav.href,
        iconKey: nav.iconKey,
        order: nav.order,
      });
    }
  }
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Feature commands the command palette should render. M2 supports only
 * `navigate` actions — `start-run` / `open-panel` need runtime that
 * does not exist yet, so they are dropped here (deferred to M3+).
 * Sorted by label.
 */
export function visibleCommands(
  features: readonly UiSafeFeature[],
): CommandRenderItem[] {
  const items: CommandRenderItem[] = [];
  for (const feature of features) {
    const state = feature.status.state;
    for (const cmd of feature.exposures.commands ?? []) {
      if (cmd.action.type !== "navigate") continue;
      if (!commandVisible(cmd.visibility, state)) continue;
      items.push({
        id: cmd.id,
        label: cmd.label,
        href: cmd.action.href,
        keywords: cmd.keywords ?? [],
      });
    }
  }
  return items.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Feature dashboard cards Mission Control should render: only for a
 * `ready` or `degraded` feature (a card with no live data is useless),
 * component resolvable, sorted by `order` (ties broken by `id`).
 */
export function visibleDashboardCards(
  features: readonly UiSafeFeature[],
  deps: ShellSelectorDeps = DEFAULT_DEPS,
): CardRenderItem[] {
  const items: CardRenderItem[] = [];
  for (const feature of features) {
    const state = feature.status.state;
    if (state !== "ready" && state !== "degraded") continue;
    for (const card of feature.exposures.dashboardCards ?? []) {
      if (!deps.hasCardComponent(card.componentKey)) continue;
      items.push({
        id: card.id,
        componentKey: card.componentKey,
        order: card.order,
        span: card.span ?? 1,
      });
    }
  }
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * One row per registered feature for the settings page — EVERY feature
 * in EVERY state (the operator must see a disabled feature and why).
 * `settingsPanelKey` is non-null only when the feature declares a
 * panel AND its componentKey resolves.
 */
export function featureSettingsRows(
  features: readonly UiSafeFeature[],
  deps: ShellSelectorDeps = DEFAULT_DEPS,
): SettingsRow[] {
  return features.map((feature) => {
    const panelKey = feature.exposures.settingsPanel?.componentKey;
    return {
      id: feature.id,
      title: feature.title,
      description: feature.description,
      state: feature.status.state,
      reasons: feature.status.reasons,
      canDisable: feature.canDisable,
      settingsPanelKey:
        panelKey && deps.hasSettingsComponent(panelKey) ? panelKey : null,
    };
  });
}
