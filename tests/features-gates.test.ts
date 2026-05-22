// Feature route gates (Phase 1C — M1).
//
// next/navigation's notFound() is mocked to throw a recognizable
// error so the page gates can be asserted in a node test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import {
  registerFeature,
  __resetRegistry,
} from "../src/kernel/features/registry";
import {
  requireFeatureReady,
  requireFeatureEnabled,
  gateFeatureApi,
} from "../src/app/_lib/featureGates";
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

const degradedHealth = async (): Promise<FeatureHealth> => ({
  status: "degraded",
});

const flags = (id: string, on: boolean) =>
  ({ enablement: new Map([[id, on]]) });

const localReq = () => new Request("http://127.0.0.1:3000/api/x");
const crossOriginReq = () =>
  new Request("http://127.0.0.1:3000/api/x", {
    headers: { origin: "http://evil.example" },
  });

beforeEach(() => __resetRegistry());

describe("requireFeatureReady", () => {
  it("returns the feature when its state is ready", async () => {
    register(feature({ id: "ok" }));
    const r = await requireFeatureReady("ok", flags("ok", true));
    expect(r.module.id).toBe("ok");
  });

  it("calls notFound() when the feature is disabled", async () => {
    register(feature({ id: "off" }));
    await expect(
      requireFeatureReady("off", flags("off", false)),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound() when the feature is degraded", async () => {
    register(feature({ id: "deg", health: degradedHealth }));
    await expect(
      requireFeatureReady("deg", flags("deg", true)),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound() for an unknown feature id", async () => {
    await expect(
      requireFeatureReady("ghost", { enablement: new Map() }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("requireFeatureEnabled", () => {
  it("returns the feature when degraded (enabled but not ready)", async () => {
    register(feature({ id: "deg", health: degradedHealth }));
    const r = await requireFeatureEnabled("deg", flags("deg", true));
    expect(r.status.state).toBe("degraded");
  });

  it("calls notFound() when the feature is disabled", async () => {
    register(feature({ id: "off" }));
    await expect(
      requireFeatureEnabled("off", flags("off", false)),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("gateFeatureApi", () => {
  it("returns 403 on an origin-check failure", async () => {
    register(feature({ id: "x" }));
    const res = await gateFeatureApi(
      crossOriginReq(),
      "x",
      "status-only",
      flags("x", true),
    );
    expect(res?.status).toBe(403);
  });

  it("returns 404 for an unknown feature id in EVERY mode", async () => {
    for (const mode of ["enabled", "ready", "status-only"] as const) {
      const res = await gateFeatureApi(localReq(), "ghost", mode, {
        enablement: new Map(),
      });
      expect(res?.status).toBe(404);
    }
  });

  it("returns 404 for a disabled known feature in enabled/ready modes", async () => {
    register(feature({ id: "off" }));
    for (const mode of ["enabled", "ready"] as const) {
      const res = await gateFeatureApi(
        localReq(),
        "off",
        mode,
        flags("off", false),
      );
      expect(res?.status).toBe(404);
    }
  });

  it("passes through (null) in status-only mode for a known disabled feature", async () => {
    register(feature({ id: "off" }));
    const res = await gateFeatureApi(
      localReq(),
      "off",
      "status-only",
      flags("off", false),
    );
    expect(res).toBeNull();
  });

  it("returns 503 in ready mode when a known feature is degraded", async () => {
    register(feature({ id: "deg", health: degradedHealth }));
    const res = await gateFeatureApi(
      localReq(),
      "deg",
      "ready",
      flags("deg", true),
    );
    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body.error).toBe("feature-not-ready");
  });

  it("passes through (null) when the feature is ready", async () => {
    register(feature({ id: "ok" }));
    const res = await gateFeatureApi(
      localReq(),
      "ok",
      "ready",
      flags("ok", true),
    );
    expect(res).toBeNull();
  });
});
