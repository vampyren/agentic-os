// Scheduler UI exposures (Phase 1C — M2).
//
// M1 declared an empty exposures manifest; M2 populates the
// registry-driven shell surfaces. The shell consumes these — adding a
// nav item or a command means editing THIS file, not the sidebar /
// command-palette components (the M2 exit-criteria proof).
//
// PR2 populates `nav` + `commands`; the dashboard card and settings
// panel land in M2 PR3.

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
};
