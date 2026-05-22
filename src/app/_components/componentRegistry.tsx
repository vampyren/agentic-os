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
// Each registered component is hand-built by its feature and imported
// here explicitly — registration is a code edit, never dynamic.

import type { ComponentType } from "react";
import SchedulerStatusCard from "@/features/scheduler/components/SchedulerStatusCard";
import SchedulerSettingsPanel from "@/features/scheduler/components/SchedulerSettingsPanel";

// componentKey → dashboard card component.
const CARD_COMPONENTS: Record<string, ComponentType> = {
  "scheduler.status-card": SchedulerStatusCard,
};

// componentKey → settings panel component.
const SETTINGS_COMPONENTS: Record<string, ComponentType> = {
  "scheduler.settings-panel": SchedulerSettingsPanel,
};

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
