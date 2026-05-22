// Feature lifecycle resolver (Phase 1C — M1).
//
// Exercises resolveFeature / resolveAllFeatures / computeVisibility
// with INJECTED enablement + router deps, so no disk config is read.

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  registerFeature,
  __resetRegistry,
} from "../src/kernel/features/registry";
import {
  resolveFeature,
  resolveAllFeatures,
  computeVisibility,
} from "../src/kernel/features/resolver";
import type { CapabilityProbe } from "../src/kernel/features/resolver";
import type {
  FeatureModule,
  FeatureHealth,
} from "../src/kernel/features/types";

function feature(overrides: Partial<FeatureModule> = {}): FeatureModule {
  return {
    id: "feat",
    title: "Feat",
    description: "a feature",
    category: "automation",
    lifecycle: { defaultEnabled: true, canDisable: true },
    config: { schema: z.object({}).strict(), defaults: {} },
    sideEffects: [],
    requiredCapabilities: [],
    optionalCapabilities: [],
    ...overrides,
  };
}

function register(mod: FeatureModule): void {
  registerFeature(mod, { featureId: mod.id });
}

const noCapabilities: CapabilityProbe = { has: () => false };

const enabled = (id: string) => new Map([[id, true]]);
const disabled = (id: string) => new Map([[id, false]]);

describe("resolveFeature", () => {
  beforeEach(() => __resetRegistry());

  it("returns undefined for an unregistered feature id", async () => {
    expect(await resolveFeature("nope")).toBeUndefined();
  });

  it("is ready for an enabled feature with no missing deps", async () => {
    register(feature({ id: "ready-one" }));
    const r = await resolveFeature("ready-one", {
      enablement: enabled("ready-one"),
    });
    expect(r?.status.state).toBe("ready");
    expect(r?.status.reasons).toEqual([]);
  });

  it("is disabled when the persisted flag is false", async () => {
    register(feature({ id: "off" }));
    const r = await resolveFeature("off", { enablement: disabled("off") });
    expect(r?.status.state).toBe("disabled");
    expect(r?.status.reasons[0]?.code).toBe("config-disabled");
  });

  it("falls back to lifecycle.defaultEnabled when no flag is persisted", async () => {
    register(feature({ id: "def-off", lifecycle: { defaultEnabled: false, canDisable: true } }));
    register(feature({ id: "def-on", lifecycle: { defaultEnabled: true, canDisable: true } }));
    const off = await resolveFeature("def-off", { enablement: new Map() });
    const on = await resolveFeature("def-on", { enablement: new Map() });
    expect(off?.status.state).toBe("disabled");
    expect(on?.status.state).toBe("ready");
  });

  it("is unavailable with reason missing-required-capability", async () => {
    register(feature({ id: "needs-cap", requiredCapabilities: ["chat.generate"] }));
    const r = await resolveFeature("needs-cap", {
      enablement: enabled("needs-cap"),
      router: noCapabilities,
    });
    expect(r?.status.state).toBe("unavailable");
    expect(r?.status.reasons[0]?.code).toBe("missing-required-capability");
    expect(r?.status.reasons[0]?.capabilityId).toBe("chat.generate");
  });

  it("is degraded when an optional capability is missing", async () => {
    register(feature({ id: "opt-cap", optionalCapabilities: ["chat.generate"] }));
    const r = await resolveFeature("opt-cap", {
      enablement: enabled("opt-cap"),
      router: noCapabilities,
    });
    expect(r?.status.state).toBe("degraded");
    expect(r?.status.reasons[0]?.code).toBe("missing-optional-capability");
  });

  it("is degraded when the health probe reports degraded", async () => {
    const health = async (): Promise<FeatureHealth> => ({ status: "degraded" });
    register(feature({ id: "deg-health", health }));
    const r = await resolveFeature("deg-health", {
      enablement: enabled("deg-health"),
    });
    expect(r?.status.state).toBe("degraded");
    expect(r?.status.reasons[0]?.code).toBe("health-degraded");
  });

  it("is unavailable when the health probe reports unavailable", async () => {
    const health = async (): Promise<FeatureHealth> => ({ status: "unavailable" });
    register(feature({ id: "down-health", health }));
    const r = await resolveFeature("down-health", {
      enablement: enabled("down-health"),
    });
    expect(r?.status.state).toBe("unavailable");
    expect(r?.status.reasons[0]?.code).toBe("health-down");
  });
});

describe("computeVisibility", () => {
  const policy = { defaultEnabled: true, canDisable: true };
  const hiding = { defaultEnabled: true, canDisable: true, hiddenWhenDisabled: true };

  it("ready / degraded / unavailable are visible", () => {
    expect(computeVisibility("ready", policy)).toBe("visible");
    expect(computeVisibility("degraded", policy)).toBe("visible");
    expect(computeVisibility("unavailable", policy)).toBe("visible");
  });

  it("disabled is visible by default", () => {
    expect(computeVisibility("disabled", policy)).toBe("visible");
  });

  it("disabled is hidden when hiddenWhenDisabled is set", () => {
    expect(computeVisibility("disabled", hiding)).toBe("hidden");
  });
});

describe("resolveAllFeatures", () => {
  beforeEach(() => __resetRegistry());

  it("returns one entry per registered feature", async () => {
    register(feature({ id: "one" }));
    register(feature({ id: "two" }));
    const all = await resolveAllFeatures({
      enablement: new Map([
        ["one", true],
        ["two", false],
      ]),
    });
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.module.id).sort()).toEqual(["one", "two"]);
    expect(all.find((r) => r.module.id === "two")?.status.state).toBe(
      "disabled",
    );
  });
});
