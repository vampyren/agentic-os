// FU5 PR B — hydration test for `GET /api/connectors`.
//
// Asserts the route's new behaviour:
//   - never-tested connector → no `lastValidation`;
//   - matching fingerprint → row hydrates with the stored
//     `lastValidation`;
//   - mismatched fingerprint (operator edited the config since the
//     test) → `lastValidation` is omitted, UI falls back to
//     "not tested";
//   - the response NEVER exposes `config_hash` / `configHash` /
//     `fingerprint` (server-internal contract from §9);
//   - the response carries no marker-string leakage (env var NAME,
//     resolved secret value, baseUrl marker, family-leaky message);
//   - the build-failure fingerprint path also hydrates symmetrically
//     (a misconfigured connector whose buildContext still fails the
//     same way carries its `misconfigured / <errorCode>` status
//     across refresh).
//
// The sibling `connector-fingerprint-symmetry.test.ts` proves the
// SAME fingerprint helper is called at both ends. This file asserts
// the route-side contract end-to-end.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { closeStateDbForTests } from "../src/kernel/state/db";
import { resetRunLedgerForTests } from "../src/kernel/state/runLedger";
import {
  __TEST__ as healthTest,
  resetConnectorHealthStoreForTests,
} from "../src/kernel/connectors/connectorHealth";
import {
  computeCurrentFingerprint,
  fingerprintFromInstanceConfig,
} from "../src/kernel/connectors/connectorFingerprint";
import { connectorRegistry } from "../src/kernel/connectors/registry";
import { ensureConnectorsRegistered } from "../src/kernel/connectors/registered";
import { GET as listConnectors } from "../src/app/api/connectors/route";

let tmpDir: string;
let configPath: string;
let stateDbPath: string;
let auditDir: string;
let originalConfig: string | undefined;
let originalStateDb: string | undefined;
let originalAudit: string | undefined;

const BASE = "http://127.0.0.1:3000/api/connectors";
const GET_REQ = (url: string): Request => new Request(url);

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-conn-hydration-"));
  configPath = path.join(tmpDir, "config.yaml");
  stateDbPath = path.join(tmpDir, "state.db");
  auditDir = path.join(tmpDir, "audit");
  await fs.mkdir(auditDir, { recursive: true });

  originalConfig = process.env.AGENTIC_OS_CONFIG;
  originalStateDb = process.env.AGENTIC_OS_STATE_DB;
  originalAudit = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_CONFIG = configPath;
  process.env.AGENTIC_OS_STATE_DB = stateDbPath;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;

  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();

  // Initialise the state DB with v1 + v2.
  const db = new Database(stateDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath: stateDbPath });
  db.close();
});

afterEach(async () => {
  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();
  restoreEnv("AGENTIC_OS_CONFIG", originalConfig);
  restoreEnv("AGENTIC_OS_STATE_DB", originalStateDb);
  restoreEnv("AGENTIC_OS_AUDIT_DIR", originalAudit);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function restoreEnv(name: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[name];
  else process.env[name] = prev;
}

async function writeConfig(yaml: string): Promise<void> {
  await fs.writeFile(configPath, yaml, "utf8");
}

async function listBody(): Promise<{
  ok: boolean;
  connectors: Array<{
    connectorId: string;
    lastValidation?: {
      status: string;
      errorCode?: string;
      message?: string;
      testedAt: string;
      durationMs: number;
    };
  }>;
  raw: string;
}> {
  const res = await listConnectors(
    GET_REQ(`${BASE}?_=hydrate-test`),
  );
  const raw = await res.text();
  return { ...JSON.parse(raw), raw };
}

/** Seed a connector_health row directly via the store (FK off — the test
 *  doesn't run actual testConnection RunLedger entries). The row carries
 *  the configHash the caller wants tested for match/mismatch. */
function seedHealthRow(opts: {
  connectorId: string;
  configHash: string;
  status?: string;
  errorCode?: string;
  message?: string;
}): void {
  const db = new Database(stateDbPath);
  db.pragma("foreign_keys = OFF");
  const store = healthTest.newStore(db);
  store.recordTest({
    connectorId: opts.connectorId,
    validation: {
      status: (opts.status as "valid") ?? "valid",
      ...(opts.errorCode
        ? { errorCode: opts.errorCode as never }
        : {}),
      ...(opts.message ? { message: opts.message } : {}),
      testedAt: "2026-05-24T10:00:00.000Z",
      durationMs: 42,
    },
    testStartedAt: "2026-05-24T09:59:00.000Z",
    configHash: opts.configHash,
    runId: null,
  });
  db.close();
}

describe("GET /api/connectors — FU5 hydration (PR B)", () => {
  it("never-tested connector → no `lastValidation`", async () => {
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  never-c:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "",
    ].join("\n"));

    ensureConnectorsRegistered();
    const body = await listBody();
    expect(body.ok).toBe(true);
    expect(body.connectors).toHaveLength(1);
    expect(body.connectors[0]!.connectorId).toBe("never-c");
    expect(body.connectors[0]!.lastValidation).toBeUndefined();
  });

  it("fingerprint match → row hydrates with stored validation", async () => {
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  c1:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "",
    ].join("\n"));

    ensureConnectorsRegistered();

    // Compute the CURRENT fingerprint the route will recompute.
    const currentHash = computeCurrentFingerprint(
      "c1",
      {
        enabled: false,
        typeFamily: "cli-acp-agent",
      },
      connectorRegistry,
    );
    seedHealthRow({
      connectorId: "c1",
      configHash: currentHash,
      status: "valid",
    });

    const body = await listBody();
    const c1 = body.connectors.find((c) => c.connectorId === "c1")!;
    expect(c1.lastValidation).toBeDefined();
    expect(c1.lastValidation!.status).toBe("valid");
    expect(c1.lastValidation!.testedAt).toBe("2026-05-24T10:00:00.000Z");
  });

  it("fingerprint MISMATCH → `lastValidation` omitted (operator edited config)", async () => {
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  c1:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "",
    ].join("\n"));

    ensureConnectorsRegistered();
    // Seed a row with a configHash that does NOT match the current one.
    seedHealthRow({
      connectorId: "c1",
      configHash: "0".repeat(64), // intentionally wrong
      status: "valid",
    });

    const body = await listBody();
    const c1 = body.connectors.find((c) => c.connectorId === "c1")!;
    expect(c1.lastValidation).toBeUndefined();
  });

  it("build-failure path hydrates via the fallback fingerprint (FU5 fix #1 symmetry)", async () => {
    // A connector whose buildContext fails (settings parse failure —
    // `baseUrl` isn't a valid URL) but the operator hasn't edited the
    // config since the last test. The testConnection write site uses
    // `fingerprintFromInstanceConfig`; the route's hydration must use
    // the same helper. `openai-compatible-llm` declares
    // `auth: { required: false }` so a missing authRef alone doesn't
    // break the build; we choose the invalid-URL path instead because
    // it's a real build-failure trigger.
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  broken:",
      "    enabled: false",
      "    typeFamily: openai-compatible-llm",
      "    settings:",
      "      baseUrl: not-a-valid-url",
      "      model: gpt-4o-mini",
      "",
    ].join("\n"));

    ensureConnectorsRegistered();
    // The fallback fingerprint helper hashes the raw config; we
    // recompute it the same way the route will.
    const fallbackHash = fingerprintFromInstanceConfig("broken", {
      enabled: false,
      typeFamily: "openai-compatible-llm",
      settings: { baseUrl: "not-a-valid-url", model: "gpt-4o-mini" },
    });
    seedHealthRow({
      connectorId: "broken",
      configHash: fallbackHash,
      status: "misconfigured",
      errorCode: "config-invalid",
      message: "connector misconfigured",
    });

    const body = await listBody();
    const row = body.connectors.find((c) => c.connectorId === "broken")!;
    expect(row.lastValidation).toBeDefined();
    expect(row.lastValidation!.status).toBe("misconfigured");
    expect(row.lastValidation!.errorCode).toBe("config-invalid");
  });

  it("API response does NOT expose configHash / config_hash / fingerprint (§9)", async () => {
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  c1:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "",
    ].join("\n"));

    ensureConnectorsRegistered();
    const currentHash = computeCurrentFingerprint(
      "c1",
      { enabled: false, typeFamily: "cli-acp-agent" },
      connectorRegistry,
    );
    seedHealthRow({
      connectorId: "c1",
      configHash: currentHash,
      status: "valid",
    });

    const body = await listBody();
    expect(body.raw).not.toContain("config_hash");
    expect(body.raw).not.toContain("configHash");
    expect(body.raw).not.toContain("fingerprint");
    // And the configHash value bytes don't appear in the response.
    expect(body.raw).not.toContain(currentHash);
  });

  it("marker-string non-leak sweep — env var NAME, baseUrl, leaky family message absent", async () => {
    const ENV_NAME = "FU5_PR_B_HYDRATION_KEY_MARKER";
    const BASE_URL_MARKER = "https://fu5-pr-b-hydration.example.test/v1";
    const LEAKY_MSG = "leaked sk-PR-B-MARKER-XYZ from a family";
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  c1:",
      "    enabled: false",
      "    typeFamily: openai-compatible-llm",
      "    presetId: openai",
      `    authRef: env:${ENV_NAME}`,
      "    settings:",
      `      baseUrl: ${BASE_URL_MARKER}`,
      "      model: m",
      "",
    ].join("\n"));

    ensureConnectorsRegistered();
    // Hash whatever the route computes (we don't care about match here
    // — we're sweeping the WHOLE response for leakage, both with and
    // without the lastValidation populated).
    const currentHash = computeCurrentFingerprint(
      "c1",
      {
        enabled: false,
        typeFamily: "openai-compatible-llm",
        presetId: "openai",
        authRef: `env:${ENV_NAME}`,
        settings: { baseUrl: BASE_URL_MARKER, model: "m" },
      },
      connectorRegistry,
    );
    seedHealthRow({
      connectorId: "c1",
      configHash: currentHash,
      status: "invalid",
      errorCode: "auth-failed",
      // The stored `message` is the kernel's NEUTRAL message, not the
      // family-leaky one — testConnection.neutralMessage already
      // sanitises this. We seed it directly to assert the row's bytes
      // don't leak either way.
      message: "connector test reported auth-failed",
    });

    const body = await listBody();
    expect(body.raw).not.toContain(ENV_NAME);
    expect(body.raw).not.toContain(BASE_URL_MARKER);
    expect(body.raw).not.toContain(LEAKY_MSG);
    expect(body.raw).not.toContain("sk-PR-B-MARKER-XYZ");
  });

  it("mixed list: N seeded + M < N health rows returns N items, M with lastValidation", async () => {
    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  a:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "  b:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "  c:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "",
    ].join("\n"));
    ensureConnectorsRegistered();

    // Only b has a fresh health row; a + c are never-tested.
    const hashB = computeCurrentFingerprint(
      "b",
      { enabled: false, typeFamily: "cli-acp-agent" },
      connectorRegistry,
    );
    seedHealthRow({ connectorId: "b", configHash: hashB, status: "valid" });

    const body = await listBody();
    expect(body.connectors).toHaveLength(3);
    const byId = Object.fromEntries(
      body.connectors.map((c) => [c.connectorId, c]),
    );
    expect(byId["a"]!.lastValidation).toBeUndefined();
    expect(byId["b"]!.lastValidation).toBeDefined();
    expect(byId["b"]!.lastValidation!.status).toBe("valid");
    expect(byId["c"]!.lastValidation).toBeUndefined();
  });

  it("connector_health store failure does NOT break the route (defence-in-depth)", async () => {
    // Point the singleton's lazy init at a non-existent path so the
    // initial getMany would fail; the route should still return the
    // projection without lastValidation.
    process.env.AGENTIC_OS_STATE_DB = path.join(tmpDir, "does-not-exist", "state.db");
    closeStateDbForTests();
    resetRunLedgerForTests();
    resetConnectorHealthStoreForTests();

    await writeConfig([
      "vault:",
      `  root: ${tmpDir}`,
      "connectors:",
      "  c1:",
      "    enabled: false",
      "    typeFamily: cli-acp-agent",
      "",
    ].join("\n"));
    ensureConnectorsRegistered();
    const body = await listBody();
    expect(body.ok).toBe(true);
    expect(body.connectors).toHaveLength(1);
    expect(body.connectors[0]!.lastValidation).toBeUndefined();
  });
});
