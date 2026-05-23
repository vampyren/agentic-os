// cli-acp-agent connector family — agent.run via the existing subprocess
// transport (a real node echo-script bin), no second spawn path.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { promises as fs, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { RunLedger } from "../src/kernel/state/runLedger";
import { __TEST__ as agentTest } from "../src/kernel/registry";
import { createSubprocessTransport } from "../src/kernel/transports/subprocess";
import { __TEST__ as connectorTest } from "../src/kernel/connectors/registry";
import type { ConnectorsConfig } from "../src/kernel/connectors/schema";
import type {
  ConnectorFamilyDefinition,
  ConnectorInvokeContext,
} from "../src/kernel/connectors/types";
import type { AgentManifest } from "../src/kernel/types";
import { createCliAcpAgentFamily } from "../src/connectors/cli-acp-agent";
import { createCapabilityRouter } from "../src/kernel/capabilities/router";

// ── one-time fixture ──────────────────────────────────────────────────────
let suiteDir: string;
let echoScript: string;
let missingBin: string;
let agentReg: ReturnType<typeof agentTest.newRegistry>;
let family: ConnectorFamilyDefinition;

function manifest(name: string, bin: string, args: string[]): AgentManifest {
  return {
    name,
    displayName: name,
    transport: "subprocess",
    transportConfig: { bin, args, timeoutMs: 5000 },
  };
}

beforeAll(async () => {
  suiteDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-acp-suite-"));
  echoScript = path.join(suiteDir, "echo.js");
  writeFileSync(
    echoScript,
    "process.stdout.write('echo: ' + process.argv.slice(2).join(' '));",
    "utf8",
  );
  missingBin = path.join(suiteDir, "definitely-not-installed");

  agentReg = agentTest.newRegistry();
  // Real subprocess transports — `node echo.js {prompt}` for both real agents.
  for (const name of ["claude-code", "hermes"] as const) {
    const m = manifest(name, "node", [echoScript, "{prompt}"]);
    agentTest.injectAgent(agentReg, m, createSubprocessTransport(m));
  }
  // An agent that points at a missing binary — exercises the not-installed path.
  {
    const m = manifest("missing-agent", missingBin, ["{prompt}"]);
    agentTest.injectAgent(agentReg, m, createSubprocessTransport(m));
  }

  family = createCliAcpAgentFamily({ agentRegistry: agentReg });
});

afterAll(() => {
  rmSync(suiteDir, { recursive: true, force: true });
});

// ── per-test ledger + audit dir ───────────────────────────────────────────
let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let originalAuditEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-acp-"));
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");
  mkdirSync(process.env.AGENTIC_OS_AUDIT_DIR, { recursive: true });
  const dbPath = path.join(tmpDir, "state.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
});

afterEach(async () => {
  try { db.close(); } catch { /* ignore */ }
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const config: ConnectorsConfig = {
  "claude-code": {
    enabled: true,
    typeFamily: "cli-acp-agent",
    settings: { agent: "claude-code" },
  },
  hermes: {
    enabled: true,
    typeFamily: "cli-acp-agent",
    settings: { agent: "hermes" },
  },
  "missing-bin": {
    enabled: true,
    typeFamily: "cli-acp-agent",
    settings: { agent: "missing-agent" },
  },
};

function router() {
  const reg = connectorTest.newRegistry();
  reg.register(family);
  return createCapabilityRouter(reg, config, { ledger });
}

function ctxFor(connectorId: string, agentName: string): ConnectorInvokeContext {
  return {
    connectorId,
    typeFamily: "cli-acp-agent",
    settings: { agent: agentName },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────
describe("cli-acp-agent family — capabilities", () => {
  it("family declares agent.run as its only capability in M4a-2", () => {
    expect(family.id).toBe("cli-acp-agent");
    expect(family.capabilities).toEqual(["agent.run"]);
    expect(family.auth.required).toBe(false);
  });

  it("requires settings.agent (no default agent name)", async () => {
    const broken = createCliAcpAgentFamily({ agentRegistry: agentReg });
    // family.testConnection short-circuits to misconfigured when settings
    // fail the schema (here: missing `agent`).
    const v = await broken.testConnection!({
      connectorId: "x", typeFamily: "cli-acp-agent", settings: {},
    });
    expect(v.status).toBe("misconfigured");
    expect(v.errorCode).toBe("config-invalid");
  });
});

describe("cli-acp-agent family — agent.run via the router", () => {
  it("routes a successful echo through the Claude Code instance", async () => {
    const res = await router().invoke("agent.run", { prompt: "hello world" }, {
      connectorId: "claude-code",
    });
    expect(res.status).toBe("success");
    expect(res.connectorId).toBe("claude-code");
    const out = res.output as { text: string };
    expect(out.text).toContain("echo: hello world");

    const run = ledger.listRuns()[0]!;
    expect(run.kind).toBe("capability-invoke");
    expect(run.status).toBe("succeeded");
    expect(run.connectorId).toBe("claude-code");
  });

  it("routes the SAME family through the Hermes instance with no second spawn path", async () => {
    const res = await router().invoke("agent.run", { prompt: "ping" }, {
      connectorId: "hermes",
    });
    expect(res.status).toBe("success");
    expect(res.connectorId).toBe("hermes");
    expect((res.output as { text: string }).text).toContain("echo: ping");
  });

  it("a missing binary fails neutrally — no path or stderr leaks", async () => {
    const res = await router().invoke("agent.run", { prompt: "x" }, {
      connectorId: "missing-bin",
    });
    expect(res.status).toBe("failed");
    // The router sanitises returned failures (B13): the family's errorCode
    // is dropped and the canonical neutral code is surfaced.
    expect(res.errorCode).toBe("connector-returned-failure");
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(missingBin);
    expect(serialized).not.toContain("ENOENT");

    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("connector-returned-failure");
  });

  it("a malformed input is a neutral failure (no prompt -> failed)", async () => {
    const res = await router().invoke("agent.run", {}, {
      connectorId: "claude-code",
    });
    expect(res.status).toBe("failed");
    // The connector dispatched (router can't peek at the input shape), so the
    // run is recorded as a sanitized failure.
    expect(ledger.listRuns()[0]!.status).toBe("failed");
  });
});

describe("cli-acp-agent family — testConnection", () => {
  it("a live binary maps to a valid validation", async () => {
    const v = await family.testConnection!(ctxFor("claude-code", "claude-code"));
    expect(v.status).toBe("valid");
    expect(v.errorCode).toBeUndefined();
  });

  it("a missing binary maps to unreachable / binary-not-found with no leaked path", async () => {
    const v = await family.testConnection!(ctxFor("missing-bin", "missing-agent"));
    expect(v.status).toBe("unreachable");
    expect(v.errorCode).toBe("binary-not-found");
    const serialized = JSON.stringify(v);
    expect(serialized).not.toContain(missingBin);
    expect(serialized).not.toContain("ENOENT");
  });
});
