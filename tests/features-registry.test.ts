// Feature registry (Phase 1C — M1).
//
// Covers the module-level registry API (register / get / list /
// getExposures / __resetRegistry) plus the duplicate-id and
// exposure-mismatch guards, and the capability-derived
// resolveFeatureHealth helper retained from the M2 foundation.

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  registerFeature,
  getFeature,
  getExposures,
  listFeatures,
  resolveFeatureHealth,
  __resetRegistry,
} from "../src/kernel/features/registry";
import type {
  FeatureModule,
  FeatureExposures,
} from "../src/kernel/features/types";
import type {
  CapabilityId,
  CapabilityRouter,
  CapabilityInvokeResult,
} from "../src/kernel/capabilities/types";

function fakeFeature(overrides: Partial<FeatureModule> = {}): FeatureModule {
  return {
    id: "fake-feature",
    title: "Fake Feature",
    description: "a feature used in tests",
    category: "core",
    lifecycle: { defaultEnabled: true, canDisable: true },
    config: { schema: z.object({}).strict(), defaults: {} },
    sideEffects: [],
    ...overrides,
  };
}

function fakeExposures(
  featureId: string,
  overrides: Partial<FeatureExposures> = {},
): FeatureExposures {
  return { featureId, ...overrides };
}

function fakeRouter(provided: CapabilityId[]): CapabilityRouter {
  const set = new Set<CapabilityId>(provided);
  return {
    has: (cap) => set.has(cap),
    list: () => [],
    invoke: async <T = unknown>(
      capability: CapabilityId,
    ): Promise<CapabilityInvokeResult<T>> => ({
      status: "skipped",
      capability,
    }),
  };
}

describe("feature registry", () => {
  beforeEach(() => __resetRegistry());

  it("registers a new feature with its exposures", () => {
    const feat = fakeFeature({ id: "alpha" });
    registerFeature(feat, fakeExposures("alpha"));
    expect(getFeature("alpha")).toBe(feat);
  });

  it("throws on a duplicate feature id", () => {
    registerFeature(fakeFeature({ id: "dup" }), fakeExposures("dup"));
    expect(() =>
      registerFeature(fakeFeature({ id: "dup" }), fakeExposures("dup")),
    ).toThrow(/already registered/i);
  });

  it("throws when exposures.featureId does not match module.id", () => {
    expect(() =>
      registerFeature(fakeFeature({ id: "beta" }), fakeExposures("gamma")),
    ).toThrow(/mismatch/i);
  });

  it("getFeature returns the registered module", () => {
    const feat = fakeFeature({ id: "delta" });
    registerFeature(feat, fakeExposures("delta"));
    expect(getFeature("delta")).toBe(feat);
  });

  it("getFeature returns undefined for an unknown id", () => {
    expect(getFeature("ghost")).toBeUndefined();
  });

  it("listFeatures returns every registered module", () => {
    const a = fakeFeature({ id: "a" });
    const b = fakeFeature({ id: "b" });
    registerFeature(a, fakeExposures("a"));
    registerFeature(b, fakeExposures("b"));
    expect(listFeatures()).toEqual([a, b]);
  });

  it("getExposures returns the registered exposures", () => {
    const exposures = fakeExposures("eps", {
      nav: [
        {
          id: "eps-nav",
          label: "Eps",
          href: "/eps",
          iconKey: "clock",
          order: 1,
        },
      ],
    });
    registerFeature(fakeFeature({ id: "eps" }), exposures);
    expect(getExposures("eps")).toBe(exposures);
    expect(getExposures("ghost")).toBeUndefined();
  });

  it("__resetRegistry clears all registered features", () => {
    registerFeature(fakeFeature({ id: "temp" }), fakeExposures("temp"));
    expect(listFeatures()).toHaveLength(1);
    __resetRegistry();
    expect(listFeatures()).toHaveLength(0);
    expect(getFeature("temp")).toBeUndefined();
  });
});

describe("resolveFeatureHealth", () => {
  it("returns ok when the feature declares no required capabilities", () => {
    const health = resolveFeatureHealth(fakeFeature(), fakeRouter([]));
    expect(health.status).toBe("ok");
    expect(health.missingCapabilities).toBeUndefined();
  });

  it("returns ok when every required capability is provided", () => {
    const feat = fakeFeature({
      requiredCapabilities: ["chat.generate", "media.image.generate"],
    });
    const router = fakeRouter(["chat.generate", "media.image.generate"]);
    expect(resolveFeatureHealth(feat, router).status).toBe("ok");
  });

  it("returns degraded with the missing capability when one is unmet", () => {
    const feat = fakeFeature({
      requiredCapabilities: ["chat.generate", "media.image.generate"],
    });
    const health = resolveFeatureHealth(feat, fakeRouter(["chat.generate"]));
    expect(health.status).toBe("degraded");
    expect(health.missingCapabilities).toEqual(["media.image.generate"]);
  });
});
