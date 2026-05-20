import { describe, expect, it } from "vitest";
import { __TEST__, resolveFeatureHealth } from "../src/kernel/features/registry";
import type { FeatureModule } from "../src/kernel/features/types";
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
    sideEffects: ["none"],
    ...overrides,
  };
}

// Minimal fake router — only `has` is consulted by resolveFeatureHealth.
// `invoke` is written generic to satisfy CapabilityRouter's signature.
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

describe("featureRegistry", () => {
  it("registers, gets, and lists a feature", () => {
    const reg = __TEST__.newRegistry();
    const feat = fakeFeature({ id: "alpha" });
    reg.register(feat);
    expect(reg.get("alpha")).toBe(feat);
    expect(reg.list()).toEqual([feat]);
  });

  it("returns undefined for an unknown feature id", () => {
    const reg = __TEST__.newRegistry();
    expect(reg.get("ghost")).toBeUndefined();
  });

  it("throws on a duplicate feature id", () => {
    const reg = __TEST__.newRegistry();
    reg.register(fakeFeature({ id: "dup" }));
    expect(() => reg.register(fakeFeature({ id: "dup" }))).toThrow(
      /already registered/i,
    );
  });

  it("__TEST__.newRegistry() yields isolated instances", () => {
    const a = __TEST__.newRegistry();
    const b = __TEST__.newRegistry();
    a.register(fakeFeature({ id: "only-a" }));
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
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
    const router = fakeRouter(["chat.generate"]); // image-gen not provided
    const health = resolveFeatureHealth(feat, router);
    expect(health.status).toBe("degraded");
    expect(health.missingCapabilities).toEqual(["media.image.generate"]);
  });

  it("lists every missing capability when none are provided", () => {
    const feat = fakeFeature({
      requiredCapabilities: ["chat.generate", "agent.run"],
    });
    const health = resolveFeatureHealth(feat, fakeRouter([]));
    expect(health.status).toBe("degraded");
    expect(health.missingCapabilities).toEqual(["chat.generate", "agent.run"]);
  });
});
