// Capability Router (Phase 1C — Milestone 2) — STUB implementation.
//
// Features call capabilities, never connectors directly. The router
// resolves a capability to an enabled connector that declares it and
// delegates. M2 registers no production connector, so in practice
// `invoke` resolves to "no provider → skipped"; the resolution logic
// itself is real and unit-tested with in-test fake connectors.
//
// NEUTRAL-RESULT CONTRACT (locked review decision): skipped / error
// results constructed by the router carry only the capability id and
// a generic message — never raw config, an authRef value, raw input,
// a secret, command args, env, or a private path. A thrown connector
// error is collapsed to a generic code; the raw error is not echoed.
//
// The router is a factory, not a global singleton — it is constructed
// against a connector registry + the resolved `connectors` config and
// handed into contexts (e.g. a future MissionContext.caps).

import type {
  CapabilityId,
  CapabilityRouter,
  CapabilityInvokeResult,
} from "./types";
import type { ConnectorDefinition } from "../connectors/types";
import type { ConnectorRegistry } from "../connectors/registry";
import type { ConnectorsConfig } from "../connectors/schema";

export function createCapabilityRouter(
  connectorRegistry: ConnectorRegistry,
  connectorsConfig: ConnectorsConfig,
): CapabilityRouter {
  // A connector is routable when it is registered AND its config entry
  // has `enabled: true`. Trust / permission enforcement is declarative-
  // only in Phase 1C and is intentionally NOT gated here.
  function isEnabled(id: string): boolean {
    return connectorsConfig[id]?.enabled === true;
  }

  function list(capability: CapabilityId): ConnectorDefinition[] {
    return connectorRegistry
      .list()
      .filter((c) => isEnabled(c.id) && c.capabilities.includes(capability));
  }

  function has(capability: CapabilityId): boolean {
    return list(capability).length > 0;
  }

  async function invoke<T = unknown>(
    capability: CapabilityId,
    input: unknown,
    opts?: { connectorId?: string; signal?: AbortSignal },
  ): Promise<CapabilityInvokeResult<T>> {
    // `input` is intentionally unused by the stub beyond forwarding it
    // to a connector's invoke — it is never echoed into a result.
    void input;

    // Candidates already pass the enabled + capability filter.
    const candidates = list(capability);

    let chosen: ConnectorDefinition | undefined;
    if (opts?.connectorId) {
      // An explicit connectorId must STILL pass the enabled +
      // capability filter. An unknown id, or a disabled connector's
      // id, is simply not among the candidates → skipped. It does not
      // bypass filtering. The requested id is not echoed back (it is
      // operator-supplied config, kept out of the neutral result).
      chosen = candidates.find((c) => c.id === opts.connectorId);
      if (!chosen) {
        return {
          status: "skipped",
          capability,
          message: `requested connector is not an enabled provider of ${capability}`,
        };
      }
    } else {
      chosen = candidates[0];
    }

    if (!chosen) {
      return {
        status: "skipped",
        capability,
        message: `no connector provides ${capability}`,
      };
    }

    if (typeof chosen.invoke !== "function") {
      return {
        status: "skipped",
        capability,
        connectorId: chosen.id,
        message: `connector does not implement invoke for ${capability}`,
      };
    }

    try {
      const result = await chosen.invoke(capability, input);
      if (result.status === "success") {
        return {
          status: "success",
          capability,
          connectorId: chosen.id,
          output: result.output as T | undefined,
          metadata: result.metadata,
        };
      }
      // A RETURNED failure is neutralised the same as a thrown one: the
      // connector's own message / errorCode / metadata may carry a
      // secret, a path, or echoed input, so none of it is passed
      // through. Generic code + message only.
      return {
        status: "failed",
        capability,
        connectorId: chosen.id,
        errorCode: "connector-returned-failure",
        message: `connector reported a failure for ${capability}`,
      };
    } catch {
      // Neutral failure: the thrown error may carry a path, an arg, or
      // a secret — it is NOT echoed. Generic code + message only.
      return {
        status: "failed",
        capability,
        connectorId: chosen.id,
        errorCode: "connector-invoke-threw",
        message: `connector invocation failed for ${capability}`,
      };
    }
  }

  return { invoke, list, has };
}
