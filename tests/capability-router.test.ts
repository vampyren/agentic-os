import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { RunLedger } from "../src/kernel/state/runLedger";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import type { ConnectorRegistry } from "../src/kernel/connectors/registry";
import type {
  ConnectorFamilyDefinition,
  ConnectorResult,
  ConnectorTypeFamily,
} from "../src/kernel/connectors/types";
import type { ConnectorsConfig } from "../src/kernel/connectors/schema";
import { createCapabilityRouter } from "../src/kernel/capabilities/router";

// The router is tested against an injected tmp-DB RunLedger and an isolated
// audit dir — never the real ~/.agentic-os.

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let originalAuditEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cap-router-"));
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

function fakeFamily(
  id: ConnectorTypeFamily,
  overrides: Partial<ConnectorFamilyDefinition> = {},
): ConnectorFamilyDefinition {
  return {
    id,
    title: `Fake ${id}`,
    kind: "managed-agent",
    transport: "subprocess",
    capabilities: ["agent.run"],
    sideEffects: ["local-process"],
    defaultTrust: "first-party",
    settingsSchema: z.unknown(),
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },
    invoke: async (): Promise<ConnectorResult> => ({ status: "success", output: "ok" }),
    ...overrides,
  };
}

function registryOf(...families: ConnectorFamilyDefinition[]): ConnectorRegistry {
  const reg = registryTest.newRegistry();
  for (const f of families) reg.register(f);
  return reg;
}

const ONE_AGENT: ConnectorsConfig = {
  "agent-a": { enabled: true, typeFamily: "cli-acp-agent" },
};

describe("CapabilityRouter — list / has", () => {
  it("lists an enabled instance whose effective set has the capability", () => {
    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), ONE_AGENT, { ledger });
    expect(r.list("agent.run").map((s) => s.connectorId)).toEqual(["agent-a"]);
    expect(r.has("agent.run")).toBe(true);
    expect(r.list("chat.generate")).toEqual([]);
    expect(r.has("chat.generate")).toBe(false);
  });

  it("excludes a disabled instance and an instance with no registered family", () => {
    const disabled: ConnectorsConfig = {
      "agent-a": { enabled: false, typeFamily: "cli-acp-agent" },
    };
    expect(
      createCapabilityRouter(registryOf(fakeFamily("cli-acp-agent")), disabled, { ledger })
        .has("agent.run"),
    ).toBe(false);
    expect(
      createCapabilityRouter(registryOf(), ONE_AGENT, { ledger }).has("agent.run"),
    ).toBe(false);
  });

  it("exposes only the instance-effective (narrowed) capability set", () => {
    const family = fakeFamily("cli-acp-agent", {
      capabilities: ["agent.run", "code.modify"],
    });
    const config: ConnectorsConfig = {
      "agent-a": { enabled: true, typeFamily: "cli-acp-agent", capabilities: ["agent.run"] },
    };
    const r = createCapabilityRouter(registryOf(family), config, { ledger });
    expect(r.has("agent.run")).toBe(true);
    expect(r.has("code.modify")).toBe(false); // narrowed away by the instance
  });

  it("list() / has() never open a Run", () => {
    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), ONE_AGENT, { ledger });
    r.list("agent.run");
    r.has("agent.run");
    expect(ledger.listRuns()).toHaveLength(0);
  });
});

describe("CapabilityRouter — invoke", () => {
  it("skips with no Run when no connector provides the capability", async () => {
    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), ONE_AGENT, { ledger });
    const res = await r.invoke("chat.generate", {});
    expect(res.status).toBe("skipped");
    expect(ledger.listRuns()).toHaveLength(0);
  });

  it("dispatches a success and opens a succeeded capability-invoke Run", async () => {
    const family = fakeFamily("cli-acp-agent", {
      invoke: async (): Promise<ConnectorResult> => ({
        status: "success", output: "hello", metadata: { tokens: 3 },
      }),
    });
    const r = createCapabilityRouter(registryOf(family), ONE_AGENT, { ledger });
    const res = await r.invoke("agent.run", {});
    expect(res.status).toBe("success");
    expect(res.output).toBe("hello");
    expect(res.connectorId).toBe("agent-a");

    const runs = ledger.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("capability-invoke");
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.connectorId).toBe("agent-a");
  });

  it("neutralises a THROWN connector error; Run fails with the sanitized code", async () => {
    const family = fakeFamily("cli-acp-agent", {
      invoke: async (): Promise<ConnectorResult> => {
        throw new Error("boom at /home/op/.ssh/id_rsa with sk-LEAKED");
      },
    });
    const r = createCapabilityRouter(registryOf(family), ONE_AGENT, { ledger });
    const res = await r.invoke("agent.run", {});
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("connector-invoke-threw");
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("boom");
    expect(serialized).not.toContain("sk-LEAKED");
    expect(serialized).not.toContain(".ssh");

    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("connector-invoke-threw"); // sanitized (B13)
  });

  it("neutralises a RETURNED failure; raw connector fields never leak", async () => {
    const family = fakeFamily("cli-acp-agent", {
      invoke: async (): Promise<ConnectorResult> => ({
        status: "failed",
        errorCode: "sk-SECRET-CODE",
        message: "failed reaching /home/op/.aws/credentials",
        metadata: { token: "sk-INNER" },
      }),
    });
    const r = createCapabilityRouter(registryOf(family), ONE_AGENT, { ledger });
    const res = await r.invoke("agent.run", {});
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("connector-returned-failure"); // sanitized (B13)
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("sk-SECRET-CODE");
    expect(serialized).not.toContain("sk-INNER");
    expect(serialized).not.toContain(".aws");

    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("connector-returned-failure");
  });

  it("an explicit connectorId dispatches that instance", async () => {
    const config: ConnectorsConfig = {
      "agent-a": { enabled: true, typeFamily: "cli-acp-agent" },
      "agent-b": { enabled: true, typeFamily: "cli-acp-agent" },
    };
    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), config, { ledger });
    const res = await r.invoke("agent.run", {}, { connectorId: "agent-b" });
    expect(res.status).toBe("success");
    expect(res.connectorId).toBe("agent-b");
    expect(ledger.listRuns()[0]!.connectorId).toBe("agent-b");
  });

  it("an unknown connectorId is a neutral failure with no Run and no echo", async () => {
    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), ONE_AGENT, { ledger });
    const res = await r.invoke("agent.run", {}, { connectorId: "ghost-connector" });
    expect(res.status).toBe("failed");
    expect(JSON.stringify(res)).not.toContain("ghost-connector");
    expect(ledger.listRuns()).toHaveLength(0);
  });

  it("a disabled connectorId is skipped with no Run", async () => {
    const config: ConnectorsConfig = {
      "agent-a": { enabled: false, typeFamily: "cli-acp-agent" },
    };
    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), config, { ledger });
    const res = await r.invoke("agent.run", {}, { connectorId: "agent-a" });
    expect(res.status).toBe("skipped");
    expect(ledger.listRuns()).toHaveLength(0);
  });

  it("a known but misconfigured instance opens a FAILED Run with config-invalid (B7)", async () => {
    // auth.required + no authRef -> buildConnectorContext returns misconfigured.
    const family = fakeFamily("cli-acp-agent", {
      auth: { required: true, supportedRefs: ["env"] },
    });
    const r = createCapabilityRouter(registryOf(family), ONE_AGENT, { ledger });
    const res = await r.invoke("agent.run", {}, { connectorId: "agent-a" });
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("config-invalid");

    const runs = ledger.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.errorCode).toBe("config-invalid");
  });

  it("a ledger failure is swallowed; dispatch still succeeds", async () => {
    const deadPath = path.join(tmpDir, "dead.db");
    const deadDb = new Database(deadPath);
    await runMigrations(deadDb, { dbPath: deadPath });
    const deadLedger = new RunLedger(deadDb);
    deadDb.close(); // every ledger write now throws

    const r = createCapabilityRouter(
      registryOf(fakeFamily("cli-acp-agent")), ONE_AGENT, { ledger: deadLedger });
    const res = await r.invoke("agent.run", {});
    expect(res.status).toBe("success"); // ledger failure did not break dispatch
  });
});
