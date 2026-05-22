// Capability Router (M4a — connector runtime).
//
// Features call capabilities, never connectors directly. The router resolves
// a capability to an enabled connector INSTANCE (runtime.ts) whose effective
// capability set includes it, builds the invoke context, and dispatches.
//
// NEUTRAL-RESULT CONTRACT (ADR-0012, unchanged): a skipped / failed result
// carries only the capability id, the connector instance id, and a generic
// message + a SANITIZED errorCode — never raw config, an authRef value, a
// secret, raw input, or a private path. A thrown or returned connector
// failure is collapsed to a neutral code; the raw value is never echoed (B13).
//
// CAPABILITY-INVOKE RUN POLICY (B7): a real dispatch opens a capability-invoke
// RunRecord; list()/has() and a no-candidate skip open none; a known-but-
// misconfigured instance opens a failed run; an unknown instance id opens
// none. A ledger failure is swallowed + logged neutrally; dispatch proceeds.
//
// NEUTRAL LOGGING (req 1): diagnostics log neutral ids/codes only — never a
// raw connector error, stderr, secret, or input.

import type {
  CapabilityId,
  CapabilityInvokeResult,
  CapabilityRouter,
  ConnectorInstanceSummary,
} from "./types";
import type { ConnectorRegistry } from "../connectors/registry";
import type { ConnectorsConfig } from "../connectors/schema";
import type { ResolvedConnectorInstance } from "../connectors/runtime";
import { resolveConnectorInstances } from "../connectors/runtime";
import { auditCapabilityInvoke } from "../audit";
import { getRunLedger, type RunLedger } from "../state/runLedger";
import type { RunStatus } from "../state/runTypes";

export interface CapabilityRouterDeps {
  /** Run ledger override (test seam). `null` disables capability-invoke Runs. */
  ledger?: RunLedger | null;
}

export function createCapabilityRouter(
  connectorRegistry: ConnectorRegistry,
  connectorsConfig: ConnectorsConfig,
  deps?: CapabilityRouterDeps,
): CapabilityRouter {
  const hasLedgerOverride = deps !== undefined && "ledger" in deps;
  let ledgerPromise: Promise<RunLedger | null> | undefined;

  // The ledger: a test passes deps.ledger (or null); production resolves the
  // process ledger lazily. A resolution failure is logged neutrally and
  // dispatch proceeds without a Run.
  async function getLedger(): Promise<RunLedger | null> {
    if (hasLedgerOverride) return deps?.ledger ?? null;
    if (!ledgerPromise) {
      ledgerPromise = getRunLedger().catch(() => {
        console.error("[capability-router] run ledger unavailable");
        return null;
      });
    }
    return ledgerPromise;
  }

  function resolved() {
    return resolveConnectorInstances(connectorRegistry, connectorsConfig);
  }

  function list(capability: CapabilityId): ConnectorInstanceSummary[] {
    const out: ConnectorInstanceSummary[] = [];
    for (const entry of resolved()) {
      if (!entry.build.ok) continue;
      const inst = entry.build.instance;
      if (inst.effectiveCapabilities.includes(capability)) {
        out.push({
          connectorId: inst.connectorId,
          typeFamily: inst.family.id,
          capabilities: inst.effectiveCapabilities,
          trust: inst.trust,
        });
      }
    }
    return out;
  }

  function has(capability: CapabilityId): boolean {
    return list(capability).length > 0;
  }

  // ── capability-invoke Run helpers (B7) ────────────────────────────────────

  interface RunHandle { runId: string; ledger: RunLedger }

  async function openRun(
    connectorId: string,
    capability: CapabilityId,
  ): Promise<RunHandle | null> {
    const ledger = await getLedger();
    if (!ledger) return null;
    try {
      const run = ledger.createRun({
        kind: "capability-invoke",
        featureId: "connectors",
        trigger: "connector",
        connectorId,
        capabilityId: capability,
        status: "running",
        onRestart: "mark-interrupted",
        inputSummary: `capability invoke · ${capability} via ${connectorId}`,
      });
      return { runId: run.id, ledger };
    } catch {
      console.error("[capability-router] could not open capability-invoke run");
      return null;
    }
  }

  function closeRun(
    handle: RunHandle | null,
    status: Extract<RunStatus, "succeeded" | "failed">,
    errorCode?: string,
  ): void {
    if (!handle) return;
    try {
      handle.ledger.transitionRun(
        handle.runId,
        status,
        errorCode ? { errorCode } : {},
      );
    } catch {
      console.error("[capability-router] could not transition capability-invoke run");
    }
  }

  // ── invoke ────────────────────────────────────────────────────────────────

  async function dispatch<T>(
    chosen: ResolvedConnectorInstance,
    capability: CapabilityId,
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<CapabilityInvokeResult<T>> {
    const handle = await openRun(chosen.connectorId, capability);
    const ctx = signal ? { ...chosen.ctx, signal } : chosen.ctx;
    try {
      const result = await chosen.family.invoke(ctx, capability, input);
      if (result.status === "success") {
        closeRun(handle, "succeeded");
        await auditCapabilityInvoke({
          capabilityId: capability,
          connectorId: chosen.connectorId,
          runId: handle?.runId,
          status: "success",
        });
        return {
          status: "success",
          capability,
          connectorId: chosen.connectorId,
          output: result.output as T | undefined,
          metadata: result.metadata,
        };
      }
      // A RETURNED failure is neutralised: the connector's own message /
      // errorCode / metadata may carry a secret or path, so none of it is
      // passed through. The Run + result share the SANITIZED code (B13).
      const errorCode = "connector-returned-failure";
      closeRun(handle, "failed", errorCode);
      await auditCapabilityInvoke({
        capabilityId: capability,
        connectorId: chosen.connectorId,
        runId: handle?.runId,
        status: "failed",
        errorCode,
      });
      return {
        status: "failed",
        capability,
        connectorId: chosen.connectorId,
        errorCode,
        message: `connector reported a failure for ${capability}`,
      };
    } catch {
      const errorCode = "connector-invoke-threw";
      closeRun(handle, "failed", errorCode);
      await auditCapabilityInvoke({
        capabilityId: capability,
        connectorId: chosen.connectorId,
        runId: handle?.runId,
        status: "failed",
        errorCode,
      });
      return {
        status: "failed",
        capability,
        connectorId: chosen.connectorId,
        errorCode,
        message: `connector invocation failed for ${capability}`,
      };
    }
  }

  async function invoke<T = unknown>(
    capability: CapabilityId,
    input: unknown,
    opts?: { connectorId?: string; signal?: AbortSignal },
  ): Promise<CapabilityInvokeResult<T>> {
    const entries = resolved();

    if (opts?.connectorId) {
      const wantId = opts.connectorId;
      const entry = entries.find((e) => e.connectorId === wantId);
      if (!entry) {
        // Unknown id, OR a disabled instance (resolveConnectorInstances only
        // yields enabled ones). A disabled connector cannot invoke; an
        // unknown id is a neutral failure. Either way: NO Run.
        const known = connectorsConfig[wantId] !== undefined;
        return known
          ? {
              status: "skipped",
              capability,
              message: `connector is not an enabled provider of ${capability}`,
            }
          : {
              status: "failed",
              capability,
              errorCode: "connector-unknown",
              message: `requested connector cannot serve ${capability}`,
            };
      }
      if (!entry.build.ok) {
        // Known but misconfigured -> a FAILED capability-invoke Run (B7).
        const handle = await openRun(wantId, capability);
        closeRun(handle, "failed", "config-invalid");
        await auditCapabilityInvoke({
          capabilityId: capability,
          connectorId: wantId,
          runId: handle?.runId,
          status: "failed",
          errorCode: "config-invalid",
        });
        return {
          status: "failed",
          capability,
          connectorId: wantId,
          errorCode: "config-invalid",
          message: `connector is misconfigured for ${capability}`,
        };
      }
      if (!entry.build.instance.effectiveCapabilities.includes(capability)) {
        return {
          status: "skipped",
          capability,
          message: `connector does not provide ${capability}`,
        };
      }
      return dispatch<T>(entry.build.instance, capability, input, opts.signal);
    }

    // No explicit connectorId — pick the first OK instance that serves it.
    const candidate = entries.find(
      (e) => e.build.ok && e.build.instance.effectiveCapabilities.includes(capability),
    );
    if (!candidate || !candidate.build.ok) {
      return {
        status: "skipped",
        capability,
        message: `no connector provides ${capability}`,
      };
    }
    return dispatch<T>(candidate.build.instance, capability, input, opts?.signal);
  }

  return { invoke, list, has };
}
