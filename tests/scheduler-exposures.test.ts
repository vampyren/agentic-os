// Scheduler UI exposures (Phase 1C — M2).
//
// Proves the scheduler's populated exposures are well-formed for the
// registry-driven shell: featureId matches the module, every icon key
// resolves, and every command is a navigate action (M2's constraint).

import { describe, expect, it } from "vitest";
import { schedulerExposures } from "../src/features/scheduler/exposures";
import { schedulerFeature } from "../src/features/scheduler/feature";
import { hasIcon } from "../src/app/_components/iconRegistry";
import {
  hasCardComponent,
  hasSettingsComponent,
  cardComponentFor,
  settingsComponentFor,
} from "../src/app/_components/componentRegistry";

describe("schedulerExposures", () => {
  it("featureId matches the scheduler module id", () => {
    expect(schedulerExposures.featureId).toBe(schedulerFeature.id);
  });

  it("declares at least one nav item and one command", () => {
    expect(schedulerExposures.nav?.length).toBeGreaterThan(0);
    expect(schedulerExposures.commands?.length).toBeGreaterThan(0);
  });

  it("every nav iconKey resolves in the icon registry", () => {
    for (const nav of schedulerExposures.nav ?? []) {
      expect(hasIcon(nav.iconKey)).toBe(true);
    }
  });

  it("every nav href points at the /scheduler page", () => {
    for (const nav of schedulerExposures.nav ?? []) {
      expect(nav.href).toBe("/scheduler");
    }
  });

  it("every command uses a navigate action (M2 supports navigate only)", () => {
    for (const cmd of schedulerExposures.commands ?? []) {
      expect(cmd.action.type).toBe("navigate");
      if (cmd.action.type === "navigate") {
        expect(cmd.action.href).toBe("/scheduler");
      }
    }
  });

  it("every dashboard card componentKey resolves in the registry", () => {
    expect(schedulerExposures.dashboardCards?.length).toBeGreaterThan(0);
    for (const card of schedulerExposures.dashboardCards ?? []) {
      expect(hasCardComponent(card.componentKey)).toBe(true);
    }
  });

  it("the settings panel componentKey resolves in the registry", () => {
    const key = schedulerExposures.settingsPanel?.componentKey;
    expect(key).toBeDefined();
    expect(hasSettingsComponent(key!)).toBe(true);
  });
});

describe("component registry", () => {
  it("resolves null / false for an unknown componentKey", () => {
    expect(cardComponentFor("ghost.card")).toBeNull();
    expect(settingsComponentFor("ghost.panel")).toBeNull();
    expect(hasCardComponent("ghost.card")).toBe(false);
    expect(hasSettingsComponent("ghost.panel")).toBe(false);
  });
});
