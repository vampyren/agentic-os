// Component registry — registry-driven shell (Phase 1C — M2).
//
// A feature's `DashboardCardExposure.componentKey` /
// `SettingsPanelExposure.componentKey` cross the UI-safe projection as
// plain strings. The shell resolves them to HAND-BUILT components only
// through these CLOSED allowlists — there is no generic schema-to-form
// renderer (v8 §8.1: the shell owns visual quality). An unrecognised
// key resolves to `null` and the consumer skips it; the selector layer
// also drops exposures whose key is unknown so no empty slot is shown.
//
// PR1 (shell data plumbing) ships the registry with EMPTY maps and the
// resolvers/predicates. PR3 registers `SchedulerStatusCard` and
// `SchedulerSettingsPanel` once those components exist.

import type { ComponentType } from "react";

// componentKey → dashboard card component. Populated in M2 PR3.
const CARD_COMPONENTS: Record<string, ComponentType> = {};

// componentKey → settings panel component. Populated in M2 PR3.
const SETTINGS_COMPONENTS: Record<string, ComponentType> = {};

// Own-enumerable keys only — see iconRegistry.tsx for why `in` is unsafe.
const CARD_KEYS = new Set(Object.keys(CARD_COMPONENTS));
const SETTINGS_KEYS = new Set(Object.keys(SETTINGS_COMPONENTS));

/** Resolve a dashboard-card `componentKey`; unknown keys → null. */
export function cardComponentFor(key: string): ComponentType | null {
  return CARD_COMPONENTS[key] ?? null;
}

/** Resolve a settings-panel `componentKey`; unknown keys → null. */
export function settingsComponentFor(key: string): ComponentType | null {
  return SETTINGS_COMPONENTS[key] ?? null;
}

/** Whether `key` is a registered dashboard-card component. */
export function hasCardComponent(key: string): boolean {
  return CARD_KEYS.has(key);
}

/** Whether `key` is a registered settings-panel component. */
export function hasSettingsComponent(key: string): boolean {
  return SETTINGS_KEYS.has(key);
}
