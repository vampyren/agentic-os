// Closed RouterErrorCode union tests (M4a-5 PR AB, spec §9 / §13).
//
// The router emits one of exactly four neutral codes on a failure path:
//   - "connector-returned-failure"
//   - "connector-invoke-threw"
//   - "config-invalid"
//   - "connector-unknown"
//
// These tests assert: (a) the constant set matches the type union exactly;
// (b) `isRouterErrorCode` is precise; (c) every failure path returned by
// `createCapabilityRouter` carries a value that lives in the set (no raw
// string, no widening to a connector-side ConnectorErrorCode).

import { describe, expect, it } from "vitest";
import {
  ROUTER_ERROR_CODES,
  isRouterErrorCode,
  type RouterErrorCode,
} from "../src/kernel/capabilities/errorCodes";
import { createCapabilityRouter } from "../src/kernel/capabilities/router";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import type {
  ConnectorFamilyDefinition,
  ConnectorResult,
} from "../src/kernel/connectors/types";
import { z } from "zod";

describe("RouterErrorCode (closed neutral union)", () => {
  it("ROUTER_ERROR_CODES has exactly the four locked members", () => {
    const expected: RouterErrorCode[] = [
      "connector-returned-failure",
      "connector-invoke-threw",
      "config-invalid",
      "connector-unknown",
    ];
    expect(ROUTER_ERROR_CODES.size).toBe(expected.length);
    for (const code of expected) expect(ROUTER_ERROR_CODES.has(code)).toBe(true);
  });

  it("isRouterErrorCode accepts members and rejects non-members", () => {
    for (const code of ROUTER_ERROR_CODES) expect(isRouterErrorCode(code)).toBe(true);
    expect(isRouterErrorCode("auth-failed")).toBe(false);     // ConnectorErrorCode
    expect(isRouterErrorCode("blocked-network")).toBe(false); // ConnectorErrorCode
    expect(isRouterErrorCode("")).toBe(false);
    expect(isRouterErrorCode(undefined)).toBe(false);
    expect(isRouterErrorCode(42)).toBe(false);
  });
});

// Build a tiny family + config so we can exercise each failure path.
function fakeFamily(opts: {
  /** Make `invoke` throw on capability dispatch. */
  invokeThrows?: boolean;
  /** Make `invoke` return a failed ConnectorResult. */
  invokeFails?: boolean;
}): ConnectorFamilyDefinition {
  return {
    id: "cli-acp-agent",
    title: "Fake",
    kind: "managed-agent",
    transport: "subprocess",
    capabilities: ["agent.run"],
    sideEffects: ["local-process"],
    defaultTrust: "first-party",
    settingsSchema: z.object({ ok: z.literal(true) }).strict(),
    defaultSettings: { ok: true },
    auth: { required: false, supportedRefs: ["env"] },
    async invoke(): Promise<ConnectorResult> {
      if (opts.invokeThrows) throw new Error("never crosses");
      if (opts.invokeFails) return { status: "failed", errorCode: "auth-failed" };
      return { status: "success", output: { ok: true } };
    },
  };
}

describe("createCapabilityRouter — failure paths emit a closed RouterErrorCode", () => {
  it("connector-unknown for an id with no config entry", async () => {
    const reg = registryTest.newRegistry();
    const router = createCapabilityRouter(reg, {}, { ledger: null });
    const r = await router.invoke("agent.run", {}, { connectorId: "does-not-exist" });
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("connector-unknown");
    expect(isRouterErrorCode(r.errorCode)).toBe(true);
  });

  it("config-invalid for a known-but-misconfigured instance (settings parse fails)", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeFamily({}));
    // Settings deliberately fail the family schema (`ok: true`).
    const router = createCapabilityRouter(
      reg,
      {
        "broken": {
          enabled: true,
          typeFamily: "cli-acp-agent",
          settings: { ok: false } as Record<string, unknown>,
        },
      },
      { ledger: null },
    );
    const r = await router.invoke("agent.run", {}, { connectorId: "broken" });
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("config-invalid");
    expect(isRouterErrorCode(r.errorCode)).toBe(true);
  });

  it("connector-returned-failure when a family invoke returns a failed ConnectorResult", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeFamily({ invokeFails: true }));
    const router = createCapabilityRouter(
      reg,
      {
        "agent-1": {
          enabled: true,
          typeFamily: "cli-acp-agent",
          settings: { ok: true },
        },
      },
      { ledger: null },
    );
    const r = await router.invoke("agent.run", {}, { connectorId: "agent-1" });
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("connector-returned-failure");
    expect(isRouterErrorCode(r.errorCode)).toBe(true);
    // Crucially: the connector's own "auth-failed" code never crosses through
    // — the router sanitises to its closed neutral envelope (B13).
    expect(r.errorCode).not.toBe("auth-failed");
  });

  it("connector-invoke-threw when a family invoke throws", async () => {
    const reg = registryTest.newRegistry();
    reg.register(fakeFamily({ invokeThrows: true }));
    const router = createCapabilityRouter(
      reg,
      {
        "agent-2": {
          enabled: true,
          typeFamily: "cli-acp-agent",
          settings: { ok: true },
        },
      },
      { ledger: null },
    );
    const r = await router.invoke("agent.run", {}, { connectorId: "agent-2" });
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("connector-invoke-threw");
    expect(isRouterErrorCode(r.errorCode)).toBe(true);
  });
});
