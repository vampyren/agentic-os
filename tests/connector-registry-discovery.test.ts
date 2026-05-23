// Registry invariant — a family declaring `listModels` MUST also declare
// `modelDiscoverySettingsSchema` (M4a-5 PR AB, spec §5.2 / §13).
//
// The invariant guards against the v1.0 design bug: if discovery silently
// fell back to `family.settingsSchema`, an `openai-compatible-llm`-style
// schema (which requires `model`) would refuse every Load-models call,
// defeating the feature. Discovery NEVER falls back; the registry refuses
// the family at register() time.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import type {
  ConnectorFamilyDefinition,
  ConnectorModelsResult,
  ConnectorResult,
} from "../src/kernel/connectors/types";

function baseFamily(): Omit<ConnectorFamilyDefinition, "listModels" | "modelDiscoverySettingsSchema"> {
  return {
    id: "openai-compatible-llm",
    title: "Fake OpenAI-compat",
    kind: "ai-provider",
    transport: "http",
    capabilities: ["chat.generate"],
    sideEffects: ["external-api", "network"],
    defaultTrust: "first-party",
    settingsSchema: z
      .object({ baseUrl: z.string().url(), model: z.string().min(1) })
      .strict(),
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },
    async invoke(): Promise<ConnectorResult> {
      return { status: "success", output: { ok: true } };
    },
  };
}

describe("connectorRegistry — listModels invariant", () => {
  it("throws when a family declares listModels without modelDiscoverySettingsSchema", () => {
    const reg = registryTest.newRegistry();
    const bad: ConnectorFamilyDefinition = {
      ...baseFamily(),
      // listModels declared, modelDiscoverySettingsSchema missing.
      async listModels(): Promise<ConnectorModelsResult> {
        return { ok: true, models: [] };
      },
    };
    expect(() => reg.register(bad)).toThrow(/modelDiscoverySettingsSchema/);
    expect(reg.get("openai-compatible-llm")).toBeUndefined();
  });

  it("accepts a family declaring both listModels and modelDiscoverySettingsSchema", () => {
    const reg = registryTest.newRegistry();
    const good: ConnectorFamilyDefinition = {
      ...baseFamily(),
      modelDiscoverySettingsSchema: z
        .object({ baseUrl: z.string().url() })
        .passthrough(),
      async listModels(): Promise<ConnectorModelsResult> {
        return { ok: true, models: [{ id: "m1" }] };
      },
    };
    expect(() => reg.register(good)).not.toThrow();
    expect(reg.get("openai-compatible-llm")).toBe(good);
  });

  it("accepts a family declaring neither listModels nor modelDiscoverySettingsSchema (e.g. cli-acp-agent)", () => {
    const reg = registryTest.newRegistry();
    const noDiscovery: ConnectorFamilyDefinition = {
      ...baseFamily(),
      id: "cli-acp-agent",
    };
    expect(() => reg.register(noDiscovery)).not.toThrow();
    expect(reg.get("cli-acp-agent")).toBe(noDiscovery);
  });

  it("still rejects duplicate ids (pre-existing contract)", () => {
    const reg = registryTest.newRegistry();
    const f = baseFamily() as ConnectorFamilyDefinition;
    reg.register(f);
    expect(() => reg.register(f)).toThrow(/already registered/);
  });
});
