// Shell selectors — registry-driven shell (Phase 1C — M2).
//
// Proves the pure visibility / filter / sort logic the registry-driven
// shell renders: nav, commands, dashboard cards and settings rows. The
// icon / component registries are injected as fakes so these tests are
// DOM-free and independent of which keys are registered today.

import { describe, expect, it } from "vitest";
import {
  visibleNavItems,
  visibleCommands,
  visibleDashboardCards,
  featureSettingsRows,
  type ShellSelectorDeps,
} from "../src/app/_lib/shellSelectors";
import type { UiSafeFeature } from "../src/kernel/features/projection";
import type {
  FeatureExposures,
  FeatureLifecycleState,
  NavExposure,
} from "../src/kernel/features/types";

// Fake registries: only "clock" is a known icon; only "card.ok" and
// "panel.ok" are known components.
const DEPS: ShellSelectorDeps = {
  hasIcon: (k) => k === "clock",
  hasCardComponent: (k) => k === "card.ok",
  hasSettingsComponent: (k) => k === "panel.ok",
};

function feat(
  id: string,
  state: FeatureLifecycleState,
  exposures: Partial<Omit<FeatureExposures, "featureId">> = {},
  canDisable = true,
): UiSafeFeature {
  return {
    id,
    title: `${id} title`,
    description: `${id} description`,
    category: "automation",
    canDisable,
    status: { state, visibility: "visible", reasons: [] },
    exposures: { featureId: id, ...exposures },
  };
}

function navItem(over: Partial<NavExposure> = {}): NavExposure {
  return Object.assign(
    { id: "n", label: "Nav", href: "/x", iconKey: "clock", order: 1 },
    over,
  );
}

// ── visibleNavItems ─────────────────────────────────────────────────

describe("visibleNavItems", () => {
  it("includes a ready feature's nav item", () => {
    const out = visibleNavItems([feat("a", "ready", { nav: [navItem()] })], DEPS);
    expect(out.map((i) => i.id)).toEqual(["n"]);
  });

  it("hides a when-enabled item when the feature is disabled", () => {
    const nav = [navItem({ visibility: "when-enabled" })];
    expect(visibleNavItems([feat("a", "disabled", { nav })], DEPS)).toHaveLength(0);
  });

  it("hides a when-ready item when the feature is degraded", () => {
    const nav = [navItem({ visibility: "when-ready" })];
    expect(visibleNavItems([feat("a", "degraded", { nav })], DEPS)).toHaveLength(0);
  });

  it("shows an always item even when the feature is disabled", () => {
    const nav = [navItem({ visibility: "always" })];
    expect(visibleNavItems([feat("a", "disabled", { nav })], DEPS)).toHaveLength(1);
  });

  it("treats undefined visibility as when-enabled", () => {
    const nav = [navItem()]; // no visibility
    expect(visibleNavItems([feat("a", "ready", { nav })], DEPS)).toHaveLength(1);
    expect(visibleNavItems([feat("a", "disabled", { nav })], DEPS)).toHaveLength(0);
  });

  it("drops an item whose iconKey does not resolve", () => {
    const nav = [navItem({ iconKey: "ghost-icon" })];
    expect(visibleNavItems([feat("a", "ready", { nav })], DEPS)).toHaveLength(0);
  });

  it("sorts by order, breaking ties by id", () => {
    const nav = [
      navItem({ id: "z", order: 2 }),
      navItem({ id: "b", order: 1 }),
      navItem({ id: "a", order: 1 }),
    ];
    const out = visibleNavItems([feat("f", "ready", { nav })], DEPS);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "z"]);
  });
});

// ── visibleCommands ─────────────────────────────────────────────────

describe("visibleCommands", () => {
  it("shows a when-degraded-or-better command for degraded, hides for unavailable", () => {
    const commands = [
      {
        id: "c",
        label: "Cmd",
        action: { type: "navigate" as const, href: "/x" },
        visibility: "when-degraded-or-better" as const,
      },
    ];
    expect(visibleCommands([feat("a", "degraded", { commands })])).toHaveLength(1);
    expect(visibleCommands([feat("a", "unavailable", { commands })])).toHaveLength(0);
  });

  it("drops non-navigate actions in M2", () => {
    const commands = [
      { id: "nav", label: "Go", action: { type: "navigate" as const, href: "/x" } },
      {
        id: "run",
        label: "Run",
        action: { type: "start-run" as const, runKind: "mission" },
      },
      {
        id: "panel",
        label: "Panel",
        action: { type: "open-panel" as const, panelKey: "p" },
      },
    ];
    const out = visibleCommands([feat("a", "ready", { commands })]);
    expect(out.map((c) => c.id)).toEqual(["nav"]);
    expect(out[0]!.href).toBe("/x");
  });
});

// ── visibleDashboardCards ───────────────────────────────────────────

describe("visibleDashboardCards", () => {
  const cards = [{ id: "card", componentKey: "card.ok", order: 1 }];

  it("shows cards for ready and degraded features", () => {
    expect(
      visibleDashboardCards([feat("a", "ready", { dashboardCards: cards })], DEPS),
    ).toHaveLength(1);
    expect(
      visibleDashboardCards([feat("a", "degraded", { dashboardCards: cards })], DEPS),
    ).toHaveLength(1);
  });

  it("hides cards for disabled and unavailable features", () => {
    expect(
      visibleDashboardCards([feat("a", "disabled", { dashboardCards: cards })], DEPS),
    ).toHaveLength(0);
    expect(
      visibleDashboardCards(
        [feat("a", "unavailable", { dashboardCards: cards })],
        DEPS,
      ),
    ).toHaveLength(0);
  });

  it("drops a card whose componentKey does not resolve", () => {
    const ghost = [{ id: "card", componentKey: "card.ghost", order: 1 }];
    expect(
      visibleDashboardCards([feat("a", "ready", { dashboardCards: ghost })], DEPS),
    ).toHaveLength(0);
  });

  it("defaults span to 1 when absent", () => {
    const out = visibleDashboardCards(
      [feat("a", "ready", { dashboardCards: cards })],
      DEPS,
    );
    expect(out[0]!.span).toBe(1);
  });
});

// ── featureSettingsRows ─────────────────────────────────────────────

describe("featureSettingsRows", () => {
  it("returns every feature including disabled ones, with reasons", () => {
    const disabled = feat("sched", "disabled");
    disabled.status.reasons = [
      { code: "config-disabled", severity: "info", message: "off" },
    ];
    const rows = featureSettingsRows([feat("a", "ready"), disabled], DEPS);
    expect(rows.map((r) => r.id)).toEqual(["a", "sched"]);
    const schedRow = rows[1]!;
    expect(schedRow.state).toBe("disabled");
    expect(schedRow.reasons[0]!.code).toBe("config-disabled");
  });

  it("carries canDisable and resolves the settings panel key", () => {
    const withPanel = feat(
      "a",
      "ready",
      { settingsPanel: { componentKey: "panel.ok" } },
      false,
    );
    const withGhost = feat("b", "ready", {
      settingsPanel: { componentKey: "panel.ghost" },
    });
    const [a, b] = featureSettingsRows([withPanel, withGhost], DEPS);
    expect(a!.canDisable).toBe(false);
    expect(a!.settingsPanelKey).toBe("panel.ok");
    expect(b!.canDisable).toBe(true);
    expect(b!.settingsPanelKey).toBeNull();
  });
});
