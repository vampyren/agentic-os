import { describe, expect, it } from "vitest";
import { z } from "zod";
import { __TEST__ } from "../src/kernel/connectors/registry";
import type {
  ConnectorFamilyDefinition,
  ConnectorTypeFamily,
} from "../src/kernel/connectors/types";

function fakeFamily(
  id: ConnectorTypeFamily,
  overrides: Partial<ConnectorFamilyDefinition> = {},
): ConnectorFamilyDefinition {
  return {
    id,
    title: `Fake ${id}`,
    kind: "managed-agent",
    transport: "subprocess",
    capabilities: ["agent.run"],
    sideEffects: ["local-process"],
    defaultTrust: "first-party",
    settingsSchema: z.unknown(),
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },
    invoke: async () => ({ status: "success" }),
    ...overrides,
  };
}

describe("connectorRegistry", () => {
  it("registers, gets, and lists a connector family", () => {
    const reg = __TEST__.newRegistry();
    const fam = fakeFamily("cli-acp-agent");
    reg.register(fam);
    expect(reg.get("cli-acp-agent")).toBe(fam);
    expect(reg.list()).toEqual([fam]);
  });

  it("returns undefined for an unregistered family id", () => {
    const reg = __TEST__.newRegistry();
    expect(reg.get("openai-compatible-llm")).toBeUndefined();
  });

  it("throws on a duplicate family id", () => {
    const reg = __TEST__.newRegistry();
    reg.register(fakeFamily("cli-acp-agent"));
    expect(() => reg.register(fakeFamily("cli-acp-agent"))).toThrow(
      /already registered/i,
    );
  });

  it("__TEST__.newRegistry() yields isolated instances", () => {
    const a = __TEST__.newRegistry();
    const b = __TEST__.newRegistry();
    a.register(fakeFamily("cli-acp-agent"));
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });

  it("lists multiple families in registration order", () => {
    const reg = __TEST__.newRegistry();
    reg.register(fakeFamily("cli-acp-agent"));
    reg.register(fakeFamily("openai-compatible-llm"));
    expect(reg.list().map((f) => f.id)).toEqual([
      "cli-acp-agent",
      "openai-compatible-llm",
    ]);
  });
});
