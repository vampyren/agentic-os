// FU5 PR B — fingerprint symmetry: the testConnection write site
// (PR A) and the route's hydration read site (PR B) produce the SAME
// `configHash` for the same instance config state, on BOTH paths:
//
//   - Build SUCCEEDED:
//       testConnection writes via `fingerprintConnectorConfig(...)`
//       route recomputes via `computeCurrentFingerprint(...)` which
//       takes the same success branch.
//
//   - Build FAILED (auth-missing / settings-invalid / defensive-B4):
//       testConnection writes via `fingerprintFromInstanceConfig(...)`
//       route recomputes via `computeCurrentFingerprint(...)` which
//       takes the same failure branch.
//
// A regression that splits the dispatch logic between the two sites
// would make a previously-tested connector flip to "not tested" on
// every refresh. This test catches that.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { closeStateDbForTests } from "../src/kernel/state/db";
import {
  RunLedger,
  resetRunLedgerForTests,
} from "../src/kernel/state/runLedger";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import { runConnectorTest } from "../src/kernel/connectors/testConnection";
import {
  __TEST__ as healthTest,
  resetConnectorHealthStoreForTests,
  type ConnectorHealthStore,
} from "../src/kernel/connectors/connectorHealth";
import {
  computeCurrentFingerprint,
} from "../src/kernel/connectors/connectorFingerprint";
import {
  appConfigSchema,
  type AppConfig,
} from "../src/kernel/schemas/appConfig";
import type {
  ConnectorFamilyDefinition,
  ConnectorValidation,
} from "../src/kernel/connectors/types";

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let connectorHealth: ConnectorHealthStore;
let originalAuditEnv: string | undefined;
let originalStateDbEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fu5-fp-symmetry-"));
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");
  await fs.mkdir(process.env.AGENTIC_OS_AUDIT_DIR, { recursive: true });
  const dbPath = path.join(tmpDir, "state.db");
  process.env.AGENTIC_OS_STATE_DB = dbPath;
  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
  connectorHealth = healthTest.newStore(db);
});

afterEach(async () => {
  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();
  try { db.close(); } catch { /* a test may have closed it */ }
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
  if (originalStateDbEnv === undefined) delete process.env.AGENTIC_OS_STATE_DB;
  else process.env.AGENTIC_OS_STATE_DB = originalStateDbEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

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

function registryWith(fam: ConnectorFamilyDefinition) {
  const reg = registryTest.newRegistry();
  reg.register(fam);
  return reg;
}

const validation = (
  o: Partial<ConnectorValidation>,
): ConnectorValidation => ({
  status: "valid",
  testedAt: new Date().toISOString(),
  durationMs: 1,
  ...o,
});

describe("fingerprint symmetry — write site vs hydration read site", () => {
  it("BUILD SUCCESS: testConnection's stored hash == computeCurrentFingerprint over the same config", async () => {
    const fam = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    const reg = registryWith(fam);
    const cfg: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "happy-c": {
          enabled: false,
          typeFamily: "cli-acp-agent",
        },
      },
    });

    // Write path: runConnectorTest persists a configHash.
    await runConnectorTest("happy-c", {
      ledger, connectorHealth, registry: reg, config: cfg,
    });
    const storedHash = connectorHealth.get("happy-c")!.configHash;

    // Read path: the route's hydration logic recomputes via the same
    // helper. Symmetry contract: same input → same hash.
    const recomputedHash = computeCurrentFingerprint(
      "happy-c",
      cfg.connectors["happy-c"]!,
      reg,
    );
    expect(recomputedHash).toBe(storedHash);
  });

  it("BUILD FAILURE (auth-missing): testConnection's stored hash == computeCurrentFingerprint over the same config", async () => {
    const fam = family({
      auth: { required: true, supportedRefs: ["env"] },
      testConnection: async () => {
        throw new Error("must not reach family — auth should fail build");
      },
    });
    const reg = registryWith(fam);
    const cfg: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "broken-auth": {
          enabled: false,
          typeFamily: "cli-acp-agent",
          // No authRef on a required-auth family → auth-missing on build.
        },
      },
    });

    await runConnectorTest("broken-auth", {
      ledger, connectorHealth, registry: reg, config: cfg,
    });
    const storedHash = connectorHealth.get("broken-auth")!.configHash;

    const recomputedHash = computeCurrentFingerprint(
      "broken-auth",
      cfg.connectors["broken-auth"]!,
      reg,
    );
    expect(recomputedHash).toBe(storedHash);
  });

  it("BUILD FAILURE (settings-invalid): write hash == route recompute hash", async () => {
    // Family demands a `mustHave` field the instance config doesn't
    // supply → parsed.success === false → buildContext returns
    // misconfigured.
    const fam = family({
      settingsSchema: z.object({ mustHave: z.string() }),
    });
    const reg = registryWith(fam);
    const cfg: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "broken-settings": {
          enabled: false,
          typeFamily: "cli-acp-agent",
        },
      },
    });

    await runConnectorTest("broken-settings", {
      ledger, connectorHealth, registry: reg, config: cfg,
    });
    const storedHash = connectorHealth.get("broken-settings")!.configHash;
    const recomputedHash = computeCurrentFingerprint(
      "broken-settings",
      cfg.connectors["broken-settings"]!,
      reg,
    );
    expect(recomputedHash).toBe(storedHash);
  });

  it("editing the EFFECTIVE config invalidates the symmetric hash (success path)", async () => {
    // Use a family with MULTIPLE capabilities so the narrowing vs
    // no-narrowing distinction actually changes the effective list.
    // (A single-capability family would have narrow == no-narrow for
    // any subset, producing identical hashes.)
    const fam = family({
      capabilities: ["agent.run", "chat.generate"],
      testConnection: async () => validation({ status: "valid" }),
    });
    const reg = registryWith(fam);
    const cfgA: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "c1": {
          enabled: false,
          typeFamily: "cli-acp-agent",
          capabilities: ["agent.run"], // narrow to just one
        },
      },
    });
    await runConnectorTest("c1", {
      ledger, connectorHealth, registry: reg, config: cfgA,
    });
    const hashA = connectorHealth.get("c1")!.configHash;

    // Edit: drop the capability narrowing (effective set widens to both).
    const cfgB: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "c1": {
          enabled: false,
          typeFamily: "cli-acp-agent",
          // capabilities omitted → uses family max set [agent.run, chat.generate]
        },
      },
    });
    const hashB = computeCurrentFingerprint(
      "c1",
      cfgB.connectors["c1"]!,
      reg,
    );
    expect(hashB).not.toBe(hashA);
  });

  it("editing the RAW config invalidates the symmetric hash (failure path fallback)", async () => {
    const fam = family({
      settingsSchema: z.object({ mustHave: z.string() }),
    });
    const reg = registryWith(fam);
    const cfgA: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "c1": {
          enabled: false,
          typeFamily: "cli-acp-agent",
          settings: { wrongField: "alpha" },
        },
      },
    });
    await runConnectorTest("c1", {
      ledger, connectorHealth, registry: reg, config: cfgA,
    });
    const hashA = connectorHealth.get("c1")!.configHash;

    const cfgB: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "c1": {
          enabled: false,
          typeFamily: "cli-acp-agent",
          settings: { wrongField: "beta" }, // still broken, but DIFFERENT
        },
      },
    });
    const hashB = computeCurrentFingerprint(
      "c1",
      cfgB.connectors["c1"]!,
      reg,
    );
    expect(hashB).not.toBe(hashA);
  });

  it("write site and read site both dispatch to the SAME fingerprint branch (success-vs-failure produce different hashes)", async () => {
    // Same connectorId, two completely different config shapes:
    // (1) succeeds the build → effective-config fingerprint;
    // (2) fails the build → raw-config fallback fingerprint.
    // The two hashes MUST differ — proves the dispatch is doing its
    // job and not accidentally hitting the same branch.
    const famSucceed = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    const famFail = family({
      settingsSchema: z.object({ mustHave: z.string() }),
    });
    const cfg: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "c1": { enabled: false, typeFamily: "cli-acp-agent" },
      },
    });

    const okHash = computeCurrentFingerprint(
      "c1",
      cfg.connectors["c1"]!,
      registryWith(famSucceed),
    );
    const failHash = computeCurrentFingerprint(
      "c1",
      cfg.connectors["c1"]!,
      registryWith(famFail),
    );
    expect(okHash).not.toBe(failHash);
  });
});
