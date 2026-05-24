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
import {
  getConnectorHealthStore,
  type ConnectorHealthStore,
} from "./connectorHealth";
import {
  fingerprintConnectorConfig,
  fingerprintFromInstanceConfig,
} from "./connectorFingerprint";
import { buildConnectorContext, type ResolvedConnectorInstance } from "./runtime";
import { assertPublicBaseUrl } from "./ssrf";
import type { ConnectorInstanceConfig } from "./schema";
import {
  CONNECTOR_ERROR_CODE_SET,
  type ConnectorErrorCode,
  type ConnectorValidation,
} from "./types";

// The closed neutral errorCode registry — a connector cannot smuggle a secret
// or path into a Run/audit through errorCode (B13). The Set is the single
// source of truth from `types.ts` (FU5 PR A — fix #2: previously a local
// copy here drifted away from the type and dropped `response-too-large`).
function normalizeErrorCode(code: string | undefined): ConnectorErrorCode {
  return code !== undefined
    && CONNECTOR_ERROR_CODE_SET.has(code as ConnectorErrorCode)
    ? (code as ConnectorErrorCode)
    : "unknown";
}

/**
 * The neutral `message` for a connector-test result. NEVER passes through a
 * family-provided string — that could carry a secret, a private path, raw
 * stderr, or a provider response. The message is generated from the
 * (already-normalized) status + errorCode, both of which are values from
 * closed neutral unions.
 */
function neutralMessage(
  status: ConnectorValidation["status"],
  errorCode: ConnectorErrorCode | undefined,
): string {
  switch (status) {
    case "valid":
      return "connector test passed";
    case "invalid":
      return errorCode
        ? `connector test reported ${errorCode}`
        : "connector test reported a failure";
    case "unreachable":
      return "connector unreachable";
    case "misconfigured":
      return "connector misconfigured";
    case "unknown":
    default:
      return errorCode
        ? `connector test inconclusive (${errorCode})`
        : "connector test inconclusive";
  }
}

export interface RunConnectorTestDeps {
  ledger?: RunLedger | null;
  registry?: ConnectorRegistry;
  config?: AppConfig;
  /** FU5: connector_health store. Tests pass an injected store (or null
   *  to skip the write entirely); production resolves the process
   *  singleton. A resolution failure is logged neutrally and swallowed
   *  (audit JSONL remains source-of-truth). */
  connectorHealth?: ConnectorHealthStore | null;
}

export async function runConnectorTest(
  connectorId: string,
  deps?: RunConnectorTestDeps,
): Promise<ConnectorValidation> {
  const startedAt = Date.now();
  // Fallback for the connector_health UPSERT guard's freshness source
  // when the ledger is unavailable or createRun fails. The PRIMARY
  // source is the run record's `createdAt` (spec §4.1 — denormalised
  // copy of `runs.created_at`); the fallback timestamp is only used
  // when there is no run record to read from. Set BEFORE any I/O so
  // the value is stable.
  const entryTimestamp = new Date(startedAt).toISOString();
  // Populated below once the run is created; null while no run exists.
  let testStartedAt: string = entryTimestamp;
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

  // Connector health store (FU5). Same pattern as the ledger above — a
  // test passes an injected store (or null to skip the write); production
  // resolves the process singleton. Init failure is swallowed; a missing
  // store means we just don't write a connector_health row, which surfaces
  // as "not tested" in the UI until the next successful test.
  let connectorHealth: ConnectorHealthStore | null = null;
  if (deps && "connectorHealth" in deps) {
    connectorHealth = deps.connectorHealth ?? null;
  } else {
    try {
      connectorHealth = await getConnectorHealthStore();
    } catch {
      console.error("[connector-test] connector health store unavailable");
    }
  }

  let runId: string | undefined;
  if (ledger) {
    try {
      const run = ledger.createRun({
        kind: "connector-test",
        featureId: "connectors",
        trigger: "manual",
        connectorId,
        status: "running",
        onRestart: "mark-interrupted",
        inputSummary: `connector test · ${connectorId}`,
      });
      runId = run.id;
      // Spec §4.1 — `test_started_at` IS the denormalised copy of
      // `runs.created_at` (set at run-creation time, before the
      // family's testConnection executes). Use the ledger's
      // canonical timestamp when a run exists; the entry-timestamp
      // fallback is only used when the ledger is unavailable.
      testStartedAt = run.createdAt;
    } catch {
      console.error("[connector-test] could not open connector-test run");
    }
  }

  // Fingerprint inputs are populated once the instance config + resolved
  // instance are known; `finish` reads from these closures. Null until
  // populated means the fingerprint write is skipped for that finish call
  // (e.g. config-load failure — there's nothing meaningful to hash).
  let healthInstanceConfig: ConnectorInstanceConfig | null = null;
  let healthResolvedInstance: ResolvedConnectorInstance | null = null;

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

    // FU5: project the outcome into connector_health BEFORE the audit
    // line so a write failure can be logged without delaying the audit.
    // The write is best-effort: a failure is swallowed (the audit JSONL
    // remains source-of-truth, the run transition has already happened,
    // and the operator gets the validation back from this function's
    // return).
    //
    // Two fingerprint paths (FU5 PR A — fix #1):
    //   - Build SUCCEEDED → use the EFFECTIVE post-merge/post-validation
    //     config (the shape the family actually ran against). A mid-test
    //     config edit can't poison the row because we read from the
    //     captured `healthResolvedInstance.ctx.settings`, not from disk.
    //   - Build FAILED but we still have the raw instance config →
    //     fallback fingerprint over the raw instance config (secret-
    //     looking values redacted). Lets common misconfigured cases
    //     (auth-missing, config-invalid, secret-looking-key) survive
    //     refresh as "misconfigured" instead of falling back to
    //     "not tested". PR B's hydration uses the SAME helper for the
    //     same broken config → fingerprints match → row hydrates.
    //
    // Skipped entirely when we have no instance config (e.g. the
    // config-load itself failed, or no such connector instance) —
    // there's nothing meaningful to identify the row by.
    if (connectorHealth && healthInstanceConfig) {
      try {
        const configHash = healthResolvedInstance
          ? fingerprintConnectorConfig(connectorId, {
              typeFamily: healthInstanceConfig.typeFamily,
              presetId: healthInstanceConfig.presetId ?? null,
              settings: healthResolvedInstance.ctx.settings,
              capabilities: healthResolvedInstance.effectiveCapabilities,
              allowLocalNetwork:
                healthInstanceConfig.allowLocalNetwork ?? false,
              authRef: healthInstanceConfig.authRef,
            })
          : fingerprintFromInstanceConfig(connectorId, healthInstanceConfig);
        connectorHealth.recordTest({
          connectorId,
          validation: v,
          testStartedAt,
          configHash,
          runId: runId ?? null,
        });
      } catch {
        console.error("[connector-test] could not write connector health row");
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
  // Recorded for the connector_health write in `finish` so the
  // fingerprint reflects the config the test actually ran against —
  // even on misconfigured / blocked-network paths where the build can
  // still produce a resolved instance (we'd want a fingerprint that
  // matches the operator's current view for those cases too).
  healthInstanceConfig = instanceConfig;
  const family = registry.get(instanceConfig.typeFamily);
  if (!family) {
    return fail("misconfigured", "config-invalid", "connector type family is not registered");
  }

  const build = buildConnectorContext(connectorId, instanceConfig, family);
  if (!build.ok) {
    return finish({ ...build.validation, durationMs: Date.now() - startedAt });
  }
  healthResolvedInstance = build.instance;

  // HTTP families re-verify the baseUrl is not in a blocked range at test
  // time (spec §8). `effectiveAllowLocalNetwork` is the operator's instance
  // value here; PR3b will mix in the preset default at config-add time.
  if (family.transport === "http") {
    const settings = build.instance.ctx.settings as { baseUrl?: unknown };
    const effective = instanceConfig.allowLocalNetwork ?? false;
    if (typeof settings.baseUrl === "string") {
      try {
        await assertPublicBaseUrl(settings.baseUrl, {
          allowLocalNetwork: effective,
        });
      } catch {
        return fail(
          "misconfigured",
          "blocked-network",
          "connector baseUrl is in a blocked range",
        );
      }
    }
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
    const errorCode =
      raw.status === "valid" ? undefined : normalizeErrorCode(raw.errorCode);
    // raw.message is NOT passed through — a connector could carry a key, a
    // private path, raw stderr, or a provider response. The message is
    // regenerated from the sanitized status + errorCode (Jarvis fix).
    return finish({
      status: raw.status,
      ...(errorCode ? { errorCode } : {}),
      message: neutralMessage(raw.status, errorCode),
      testedAt: raw.testedAt ?? new Date().toISOString(),
      durationMs: raw.durationMs ?? Date.now() - startedAt,
    });
  } catch {
    return fail("invalid", "unknown", "connector test failed");
  }
}
