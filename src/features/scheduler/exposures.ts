// Scheduler UI exposures (Phase 1C — M2).
//
// M1 declared an empty exposures manifest; M2 populates every
// registry-driven shell surface — nav, command, dashboard card and
// settings panel. The shell consumes these: adding or changing a
// surface means editing THIS file, not the sidebar / command palette /
// dashboard / settings components (the M2 exit-criteria proof).

import type { FeatureExposures } from "@/kernel/features/types";
import { SCHEDULER_FEATURE_ID } from "./feature";

export const schedulerExposures: FeatureExposures = {
  featureId: SCHEDULER_FEATURE_ID,

  // Sidebar nav → the gated /scheduler page. `when-enabled` so the item
  // tracks the feature's lifecycle switch.
  nav: [
    {
      id: "scheduler",
      label: "Scheduler",
      href: "/scheduler",
      iconKey: "clock",
      order: 10,
      group: "feature",
      visibility: "when-enabled",
    },
  ],

  // Command palette entry — a navigate action (M2 supports navigate
  // only). `when-ready` matches the /scheduler page gate, which
  // requires the feature to be `ready` to render.
  commands: [
    {
      id: "scheduler.open",
      label: "Open Scheduler",
      keywords: ["cron", "missions", "schedule", "timer"],
      action: { type: "navigate", href: "/scheduler" },
      visibility: "when-ready",
    },
  ],

  // Mission Control card — hand-built component resolved by the shell's
  // component registry via this key.
  dashboardCards: [
    {
      id: "scheduler.status",
      componentKey: "scheduler.status-card",
      order: 10,
      span: 1,
    },
  ],

  // Read-only settings panel shown in Settings → Features.
  settingsPanel: {
    componentKey: "scheduler.settings-panel",
    summary: "Cron-style mission triggers.",
  },
};
