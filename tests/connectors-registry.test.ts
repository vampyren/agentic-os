import { describe, expect, it } from "vitest";
import { __TEST__ } from "../src/kernel/connectors/registry";
import type { ConnectorDefinition } from "../src/kernel/connectors/types";

function fakeConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    id: "fake-connector",
    title: "Fake Connector",
    kind: "ai-provider",
    transport: "http",
    capabilities: ["chat.generate"],
    sideEffects: ["external-api"],
    trust: "first-party",
    ...overrides,
  };
}

describe("connectorRegistry", () => {
  it("registers, gets, and lists a connector", () => {
    const reg = __TEST__.newRegistry();
    const conn = fakeConnector({ id: "alpha" });
    reg.register(conn);
    expect(reg.get("alpha")).toBe(conn);
    expect(reg.list()).toEqual([conn]);
  });

  it("returns undefined for an unknown connector id", () => {
    const reg = __TEST__.newRegistry();
    expect(reg.get("ghost")).toBeUndefined();
  });

  it("throws on a duplicate connector id", () => {
    const reg = __TEST__.newRegistry();
    reg.register(fakeConnector({ id: "dup" }));
    expect(() => reg.register(fakeConnector({ id: "dup" }))).toThrow(
      /already registered/i,
    );
  });

  it("__TEST__.newRegistry() yields isolated instances", () => {
    const a = __TEST__.newRegistry();
    const b = __TEST__.newRegistry();
    a.register(fakeConnector({ id: "only-in-a" }));
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });

  it("lists multiple connectors in registration order", () => {
    const reg = __TEST__.newRegistry();
    reg.register(fakeConnector({ id: "one" }));
    reg.register(fakeConnector({ id: "two" }));
    expect(reg.list().map((c) => c.id)).toEqual(["one", "two"]);
  });
});
