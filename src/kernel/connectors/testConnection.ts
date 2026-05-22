// Connector test as a Run (M4a-1, spec §9).
//
// runConnectorTest opens a `connector-test` RunRecord, builds the connector
// instance, runs the family's testConnection (or reports `unknown` when the
// family has none), transitions the run, writes a neutral audit line, and
// returns the ConnectorValidation. A normal connector failure never throws to
// the caller; a ledger failure is swallowed + logged neutrally.

import { loadConfig } from "../config";
import type { AppConfig } from "../schemas/appConfig";
import { auditConnectorTest } from "../audit";
import { getRunLedger, type RunLedger } from "../state/runLedger";
import {
  connectorRegistry as globalRegistry,
  type ConnectorRegistry,
} from "./registry";
import { buildConnectorContext } from "./runtime";
import type { ConnectorErrorCode, ConnectorValidation } from "./types";

// The closed neutral errorCode registry — a connector cannot smuggle a secret
// or path into a Run/audit through errorCode (B13).
const VALID_ERROR_CODES: ReadonlySet<string> = new Set<ConnectorErrorCode>([
  "auth-failed", "auth-missing", "rate-limited", "network-unreachable",
  "config-invalid", "capability-not-supported", "capability-unavailable",
  "external-system-unavailable", "binary-not-found", "blocked-network",
  "unknown",
]);

function normalizeErrorCode(code: string | undefined): ConnectorErrorCode {
  return code !== undefined && VALID_ERROR_CODES.has(code)
    ? (code as ConnectorErrorCode)
    : "unknown";
}

export interface RunConnectorTestDeps {
  ledger?: RunLedger | null;
  registry?: ConnectorRegistry;
  config?: AppConfig;
}

export async function runConnectorTest(
  connectorId: string,
  deps?: RunConnectorTestDeps,
): Promise<ConnectorValidation> {
  const startedAt = Date.now();
  const registry = deps?.registry ?? globalRegistry;

  // Ledger: a test passes deps.ledger (or null); production resolves the
  // process ledger. A resolution failure is logged neutrally and swallowed.
  let ledger: RunLedger | null = null;
  if (deps && "ledger" in deps) {
    ledger = deps.ledger ?? null;
  } else {
    try {
      ledger = await getRunLedger();
    } catch {
      console.error("[connector-test] run ledger unavailable");
    }
  }

  let runId: string | undefined;
  if (ledger) {
    try {
      runId = ledger.createRun({
        kind: "connector-test",
        featureId: "connectors",
        trigger: "manual",
        connectorId,
        status: "running",
        onRestart: "mark-interrupted",
        inputSummary: `connector test · ${connectorId}`,
      }).id;
    } catch {
      console.error("[connector-test] could not open connector-test run");
    }
  }

  const finish = async (
    v: ConnectorValidation,
  ): Promise<ConnectorValidation> => {
    if (ledger && runId) {
      try {
        if (v.status === "valid") {
          ledger.transitionRun(runId, "succeeded");
        } else {
          // A failed connector-test Run never has a null errorCode (B10/B13).
          ledger.transitionRun(runId, "failed", {
            errorCode: v.errorCode ?? "unknown",
          });
        }
      } catch {
        console.error("[connector-test] could not transition connector-test run");
      }
    }
    await auditConnectorTest({
      connectorId,
      runId,
      status: v.status,
      errorCode: v.errorCode,
      durationMs: v.durationMs,
    });
    return v;
  };

  const fail = (
    status: ConnectorValidation["status"],
    errorCode: ConnectorErrorCode,
    message: string,
  ): Promise<ConnectorValidation> =>
    finish({
      status,
      errorCode,
      message,
      testedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });

  // Resolve the instance config.
  let config: AppConfig;
  try {
    config = deps?.config ?? (await loadConfig());
  } catch {
    return fail("misconfigured", "config-invalid", "could not load configuration");
  }

  const instanceConfig = config.connectors[connectorId];
  if (!instanceConfig) {
    return fail("misconfigured", "config-invalid", "no such connector instance");
  }
  const family = registry.get(instanceConfig.typeFamily);
  if (!family) {
    return fail("misconfigured", "config-invalid", "connector type family is not registered");
  }

  const build = buildConnectorContext(connectorId, instanceConfig, family);
  if (!build.ok) {
    return finish({ ...build.validation, durationMs: Date.now() - startedAt });
  }

  // No testConnection on the family (req 2) -> unknown / capability-unavailable.
  if (typeof family.testConnection !== "function") {
    return fail(
      "unknown",
      "capability-unavailable",
      "connector does not support a connection test",
    );
  }

  try {
    const raw = await family.testConnection(build.instance.ctx, { runId });
    return finish({
      status: raw.status,
      ...(raw.status === "valid"
        ? {}
        : { errorCode: normalizeErrorCode(raw.errorCode) }),
      ...(raw.message !== undefined ? { message: raw.message } : {}),
      testedAt: raw.testedAt ?? new Date().toISOString(),
      durationMs: raw.durationMs ?? Date.now() - startedAt,
    });
  } catch {
    return fail("invalid", "unknown", "connector test failed");
  }
}
