import { describe, expect, it } from "vitest";
import { createCapabilityRouter } from "../src/kernel/capabilities/router";
import { __TEST__ as connectorTest } from "../src/kernel/connectors/registry";
import type {
  ConnectorDefinition,
  ConnectorResult,
} from "../src/kernel/connectors/types";
import type { CapabilityId } from "../src/kernel/capabilities/types";
import type { ConnectorsConfig } from "../src/kernel/connectors/schema";

function fakeConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    id: "fake",
    title: "Fake",
    kind: "ai-provider",
    transport: "http",
    capabilities: ["chat.generate"],
    sideEffects: ["external-api"],
    trust: "first-party",
    ...overrides,
  };
}

describe("createCapabilityRouter — list / has", () => {
  it("list() returns only enabled connectors declaring the capability", () => {
    const reg = connectorTest.newRegistry();
    reg.register(fakeConnector({ id: "a", capabilities: ["chat.generate"] }));
    reg.register(fakeConnector({ id: "b", capabilities: ["media.image.generate"] }));
    const config: ConnectorsConfig = { a: { enabled: true }, b: { enabled: true } };
    const router = createCapabilityRouter(reg, config);
    expect(router.list("chat.generate").map((c) => c.id)).toEqual(["a"]);
  });

  it("list() excludes a connector that declares the capability but is disabled", () => {
    const reg = connectorTest.newRegistry();
    reg.register(fakeConnector({ id: "a", capabilities: ["chat.generate"] }));
    const router = createCapabilityRouter(reg, { a: { enabled: false } });
    expect(router.list("chat.generate")).toEqual([]);
  });

  it("list() excludes a connector with no config entry at all", () => {
    const reg = connectorTest.newRegistry();
    reg.register(fakeConnector({ id: "a" }));
    const router = createCapabilityRouter(reg, {});
    expect(router.list("chat.generate")).toEqual([]);
  });

  it("has() reflects list()", () => {
    const reg = connectorTest.newRegistry();
    reg.register(fakeConnector({ id: "a", capabilities: ["chat.generate"] }));
    const router = createCapabilityRouter(reg, { a: { enabled: true } });
    expect(router.has("chat.generate")).toBe(true);
    expect(router.has("agent.run")).toBe(false);
  });
});

describe("createCapabilityRouter — invoke", () => {
  it("returns skipped with a neutral message when no connector provides the capability", async () => {
    const router = createCapabilityRouter(connectorTest.newRegistry(), {});
    const result = await router.invoke("chat.generate", { prompt: "hi" });
    expect(result.status).toBe("skipped");
    expect(result.capability).toBe("chat.generate");
    expect(result.message).toBe("no connector provides chat.generate");
  });

  it("vault.note.write resolves to skipped — no provider until M4", async () => {
    const router = createCapabilityRouter(connectorTest.newRegistry(), {});
    const result = await router.invoke("vault.note.write", {});
    expect(result.status).toBe("skipped");
    expect(result.capability).toBe("vault.note.write");
  });

  it("delegates to an enabled connector's invoke and returns its result", async () => {
    const reg = connectorTest.newRegistry();
    let seenCapability: CapabilityId | undefined;
    reg.register(
      fakeConnector({
        id: "worker",
        capabilities: ["chat.generate"],
        invoke: async (capability): Promise<ConnectorResult> => {
          seenCapability = capability;
          return { status: "success", output: { text: "ok" } };
        },
      }),
    );
    const router = createCapabilityRouter(reg, { worker: { enabled: true } });
    const result = await router.invoke("chat.generate", { prompt: "hi" });
    expect(seenCapability).toBe("chat.generate");
    expect(result.status).toBe("success");
    expect(result.connectorId).toBe("worker");
    expect(result.output).toEqual({ text: "ok" });
  });

  it("returns skipped when the resolved connector does not implement invoke", async () => {
    const reg = connectorTest.newRegistry();
    reg.register(fakeConnector({ id: "noinvoke", capabilities: ["chat.generate"] }));
    const router = createCapabilityRouter(reg, { noinvoke: { enabled: true } });
    const result = await router.invoke("chat.generate", {});
    expect(result.status).toBe("skipped");
    expect(result.connectorId).toBe("noinvoke");
  });

  it("honours a valid connectorId override", async () => {
    const reg = connectorTest.newRegistry();
    reg.register(
      fakeConnector({
        id: "first",
        capabilities: ["chat.generate"],
        invoke: async (): Promise<ConnectorResult> => ({ status: "success", output: "first" }),
      }),
    );
    reg.register(
      fakeConnector({
        id: "second",
        capabilities: ["chat.generate"],
        invoke: async (): Promise<ConnectorResult> => ({ status: "success", output: "second" }),
      }),
    );
    const router = createCapabilityRouter(reg, {
      first: { enabled: true },
      second: { enabled: true },
    });
    const result = await router.invoke("chat.generate", {}, { connectorId: "second" });
    expect(result.connectorId).toBe("second");
    expect(result.output).toBe("second");
  });

  // Locked review decision #4 — connectorId override edge cases.
  it("an unknown connectorId does NOT bypass filtering — returns neutral skipped", async () => {
    const reg = connectorTest.newRegistry();
    reg.register(
      fakeConnector({
        id: "real",
        capabilities: ["chat.generate"],
        invoke: async (): Promise<ConnectorResult> => ({ status: "success" }),
      }),
    );
    const router = createCapabilityRouter(reg, { real: { enabled: true } });
    const result = await router.invoke("chat.generate", {}, { connectorId: "does-not-exist" });
    expect(result.status).toBe("skipped");
    expect(result.connectorId).toBeUndefined();
  });

  it("a disabled connectorId does NOT bypass enabled filtering — returns neutral skipped", async () => {
    const reg = connectorTest.newRegistry();
    let ran = false;
    reg.register(
      fakeConnector({
        id: "off",
        capabilities: ["chat.generate"],
        invoke: async (): Promise<ConnectorResult> => {
          ran = true;
          return { status: "success", output: "should not run" };
        },
      }),
    );
    const router = createCapabilityRouter(reg, { off: { enabled: false } });
    const result = await router.invoke("chat.generate", {}, { connectorId: "off" });
    expect(result.status).toBe("skipped");
    expect(result.connectorId).toBeUndefined();
    expect(ran).toBe(false); // the disabled connector's invoke never ran
  });

  // Locked review decision #3 — neutral, non-secret-bearing results.
  it("collapses a thrown connector error to a neutral result — raw error not echoed", async () => {
    const reg = connectorTest.newRegistry();
    const secret = "sk-SUPER-SECRET-abc123";
    reg.register(
      fakeConnector({
        id: "boom",
        capabilities: ["chat.generate"],
        invoke: async (): Promise<ConnectorResult> => {
          throw new Error(`auth failed with key ${secret} at /home/spawn/.hermes/auth.json`);
        },
      }),
    );
    const router = createCapabilityRouter(reg, { boom: { enabled: true } });
    const result = await router.invoke("chat.generate", { prompt: "a private prompt body" });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("connector-invoke-threw");
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain("/home/spawn");
    expect(serialised).not.toContain("a private prompt body");
  });

  it("skipped results do not echo raw input", async () => {
    const router = createCapabilityRouter(connectorTest.newRegistry(), {});
    const result = await router.invoke("chat.generate", { apiKey: "sk-LEAK-me" });
    expect(JSON.stringify(result)).not.toContain("sk-LEAK-me");
  });
});
