import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildConnectorContext,
  resolveConnectorInstances,
} from "../src/kernel/connectors/runtime";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import type { ConnectorFamilyDefinition } from "../src/kernel/connectors/types";
import type {
  ConnectorInstanceConfig,
  ConnectorsConfig,
} from "../src/kernel/connectors/schema";

function family(
  overrides: Partial<ConnectorFamilyDefinition> = {},
): ConnectorFamilyDefinition {
  return {
    id: "cli-acp-agent",
    title: "Fake",
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

const instance = (
  o: Partial<ConnectorInstanceConfig> = {},
): ConnectorInstanceConfig => ({
  enabled: true,
  typeFamily: "cli-acp-agent",
  ...o,
});

const VAR = "RUNTIME_TEST_KEY";
let originalEnv: string | undefined;
beforeEach(() => { originalEnv = process.env[VAR]; });
afterEach(() => {
  if (originalEnv === undefined) delete process.env[VAR];
  else process.env[VAR] = originalEnv;
});

describe("buildConnectorContext", () => {
  it("builds an invocable instance for a valid config", () => {
    const r = buildConnectorContext("my-agent", instance(), family());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.instance.connectorId).toBe("my-agent");
      expect(r.instance.ctx.connectorId).toBe("my-agent");
      expect(r.instance.ctx.typeFamily).toBe("cli-acp-agent");
      expect(r.instance.effectiveCapabilities).toEqual(["agent.run"]);
    }
  });

  it("misconfigures when settings fail the family schema", () => {
    const strict = family({
      settingsSchema: z.object({ baseUrl: z.string() }).strict(),
    });
    const r = buildConnectorContext("x", instance({ settings: { wrong: 1 } }), strict);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.validation.status).toBe("misconfigured");
      expect(r.validation.errorCode).toBe("config-invalid");
    }
  });

  it("misconfigures (config-invalid) when settings carry a secret-looking key (B4)", () => {
    const r = buildConnectorContext("x", instance({ settings: { token: "sk-x" } }), family());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.validation.errorCode).toBe("config-invalid");
      expect(JSON.stringify(r.validation)).not.toContain("sk-x");
    }
  });

  it("misconfigures (auth-missing) when auth is required but no authRef is set", () => {
    const authed = family({ auth: { required: true, supportedRefs: ["env"] } });
    const r = buildConnectorContext("x", instance(), authed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.validation.errorCode).toBe("auth-missing");
  });

  it("resolves the secret into the context when auth is configured", () => {
    process.env[VAR] = "sk-runtime";
    const authed = family({ auth: { required: true, supportedRefs: ["env"] } });
    const r = buildConnectorContext("x", instance({ authRef: `env:${VAR}` }), authed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.instance.ctx.secret).toBe("sk-runtime");
  });

  it("computes the effective capability set as family ∩ instance", () => {
    const fam = family({
      capabilities: ["agent.run", "code.modify", "chat.generate"],
    });
    const r = buildConnectorContext(
      "x",
      instance({ capabilities: ["agent.run", "chat.generate"] }),
      fam,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([...r.instance.effectiveCapabilities].sort()).toEqual([
        "agent.run",
        "chat.generate",
      ]);
    }
  });

  it("trustOverride moves trust down (first-party -> untrusted)", () => {
    const r = buildConnectorContext("x", instance({ trustOverride: "untrusted" }), family());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.instance.trust).toBe("untrusted");
  });
});

describe("resolveConnectorInstances", () => {
  it("resolves enabled instances and misconfigures one whose family is unregistered", () => {
    const reg = registryTest.newRegistry();
    reg.register(family());
    const config: ConnectorsConfig = {
      on: instance({ enabled: true }),
      off: instance({ enabled: false }),
      "no-family": { enabled: true, typeFamily: "openai-compatible-llm" },
    };
    const entries = resolveConnectorInstances(reg, config);
    expect(entries.map((e) => e.connectorId).sort()).toEqual(["no-family", "on"]);

    const ok = entries.find((e) => e.connectorId === "on")!;
    expect(ok.build.ok).toBe(true);
    const broken = entries.find((e) => e.connectorId === "no-family")!;
    expect(broken.build.ok).toBe(false);
  });
});
