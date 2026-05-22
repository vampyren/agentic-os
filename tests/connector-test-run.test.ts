import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { RunLedger } from "../src/kernel/state/runLedger";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import { runConnectorTest } from "../src/kernel/connectors/testConnection";
import { appConfigSchema, type AppConfig } from "../src/kernel/schemas/appConfig";
import type {
  ConnectorFamilyDefinition,
  ConnectorValidation,
} from "../src/kernel/connectors/types";

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let originalAuditEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-test-run-"));
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");
  await fs.mkdir(process.env.AGENTIC_OS_AUDIT_DIR, { recursive: true });
  const dbPath = path.join(tmpDir, "state.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
});

afterEach(async () => {
  try { db.close(); } catch { /* a test may have closed it */ }
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
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

function configWith(entry: Record<string, unknown> = {}): AppConfig {
  return appConfigSchema.parse({
    vault: { root: tmpDir },
    connectors: {
      "my-c": { enabled: true, typeFamily: "cli-acp-agent", ...entry },
    },
  });
}

const validation = (o: Partial<ConnectorValidation>): ConnectorValidation => ({
  status: "valid",
  testedAt: new Date().toISOString(),
  durationMs: 1,
  ...o,
});

async function auditText(): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return fs.readFile(
    path.join(process.env.AGENTIC_OS_AUDIT_DIR!, `${day}.jsonl`),
    "utf8",
  );
}

describe("runConnectorTest", () => {
  it("a valid test opens a succeeded connector-test Run", async () => {
    const fam = family({ testConnection: async () => validation({ status: "valid" }) });
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("valid");

    const runs = ledger.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("connector-test");
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.connectorId).toBe("my-c");
    expect(runs[0]!.inputSummary).toBe("connector test · my-c");
  });

  it("an invalid test fails the Run with the errorCode", async () => {
    const fam = family({
      testConnection: async () => validation({ status: "invalid", errorCode: "auth-failed" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("invalid");
    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("auth-failed");
  });

  it("normalizes an out-of-union errorCode to `unknown` (B13)", async () => {
    const fam = family({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "sk-LEAK" as never }),
    });
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(fam), config: configWith(),
    });
    expect(result.errorCode).toBe("unknown");
    expect(ledger.listRuns()[0]!.errorCode).toBe("unknown");
  });

  it("no testConnection -> unknown / capability-unavailable -> failed run (req 2)", async () => {
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(family()), config: configWith(),
    });
    expect(result.status).toBe("unknown");
    expect(result.errorCode).toBe("capability-unavailable");
    expect(ledger.listRuns()[0]!.status).toBe("failed");
  });

  it("a misconfigured instance fails the run without calling the connector", async () => {
    let called = false;
    const fam = family({
      auth: { required: true, supportedRefs: ["env"] },
      testConnection: async () => {
        called = true;
        return validation({});
      },
    });
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("misconfigured");
    expect(called).toBe(false);
    expect(ledger.listRuns()[0]!.status).toBe("failed");
  });

  it("the resolved secret never appears in the audit line or the validation", async () => {
    process.env.CONN_TEST_SECRET = "sk-must-not-leak";
    const fam = family({
      auth: { required: true, supportedRefs: ["env"] },
      testConnection: async () => validation({ status: "valid" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      registry: registryWith(fam),
      config: configWith({ authRef: "env:CONN_TEST_SECRET" }),
    });
    delete process.env.CONN_TEST_SECRET;

    expect(result.status).toBe("valid");
    expect(JSON.stringify(result)).not.toContain("sk-must-not-leak");
    const audit = await auditText();
    expect(audit).toContain("connector.test");
    expect(audit).not.toContain("sk-must-not-leak");
  });

  it("a raw family `message` carrying a secret / private path is never surfaced", async () => {
    const LEAKY = "leaked sk-SECRET and /home/operator/private.json";
    const fam = family({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "auth-failed", message: LEAKY }),
    });
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(fam), config: configWith(),
    });
    // Validation: errorCode survives (normalized), message is regenerated.
    expect(result.status).toBe("invalid");
    expect(result.errorCode).toBe("auth-failed");
    expect(JSON.stringify(result)).not.toContain("sk-SECRET");
    expect(JSON.stringify(result)).not.toContain("/home/operator/private.json");

    // The failed Run still carries the normalized errorCode.
    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("auth-failed");

    // The audit line does not carry the leaked strings either.
    const audit = await auditText();
    expect(audit).toContain("connector.test");
    expect(audit).not.toContain("sk-SECRET");
    expect(audit).not.toContain("/home/operator/private.json");
  });

  it("a ledger failure does not break the test", async () => {
    db.close(); // the injected ledger is now backed by a closed DB
    const fam = family({ testConnection: async () => validation({ status: "valid" }) });
    const result = await runConnectorTest("my-c", {
      ledger, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("valid");
  });
});
