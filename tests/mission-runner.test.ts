import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { runMission } from "../src/features/scheduler/missions/runner";
import { __TEST__ as registryTest } from "../src/features/scheduler/missions/registry";
import type {
  MissionDefinition,
  MissionRunResult,
} from "../src/features/scheduler/missions/types";
import { appConfigSchema, type AppConfig } from "../src/kernel/schemas/appConfig";
import {
  toVaultRelativePath,
  type VaultRelativePath,
} from "../src/lib/vaultPaths";
import type { CapabilityInvokeResult } from "../src/kernel/capabilities/types";
import { bus } from "../src/kernel/bus";

let vaultRoot: string;
let auditDir: string;
let config: AppConfig;
let originalAuditEnv: string | undefined;

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runner-vault-"));
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-audit-"));
  await fs.mkdir(path.join(vaultRoot, "00_Inbox", "agentic-os"), {
    recursive: true,
  });
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;
  config = appConfigSchema.parse({ vault: { root: vaultRoot } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
  await fs.rm(vaultRoot, { recursive: true, force: true });
  await fs.rm(auditDir, { recursive: true, force: true });
});

function mission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: "m",
    title: "Test Mission",
    description: "test",
    enabledByDefault: true,
    manualRunnable: true,
    concurrency: "single",
    outputKind: "custom",
    optionsSchema: z.object({}).strict(),
    permissions: [],
    run: async (): Promise<MissionRunResult> => ({ status: "success" }),
    ...overrides,
  };
}

function registryWith(...defs: MissionDefinition[]) {
  const reg = registryTest.newRegistry();
  for (const d of defs) reg.register(d);
  return reg;
}

async function countFiles(dir: string): Promise<number> {
  try {
    return (await fs.readdir(dir)).length;
  } catch {
    return 0;
  }
}

const summariesFolder = toVaultRelativePath("00_Inbox/agentic-os/summaries");

describe("runMission — guard rails", () => {
  it("fails neutrally for an unknown mission id", async () => {
    const r = await runMission(
      { missionId: "no-such", trigger: "manual", rawOptions: {} },
      { registry: registryWith(), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-unknown");
  });

  it("rejects a manual run of a non-manually-runnable mission", async () => {
    const m = mission({ id: "x", manualRunnable: false });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-not-manual");
  });

  it("rejects invalid options without echoing the input", async () => {
    const m = mission({ id: "x", optionsSchema: z.object({}).strict() });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: { secretKey: "leak-me" } },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-options-invalid");
    expect(JSON.stringify(r)).not.toContain("leak-me");
    expect(JSON.stringify(r)).not.toContain("secretKey");
  });
});

describe("runMission — permission enforcement", () => {
  it("fails closed when a vault-note output lacks the vault-write permission", async () => {
    const m = mission({
      id: "x",
      permissions: [],
      run: async () => ({
        status: "success",
        outputs: [
          {
            kind: "vault-note",
            outputFolder: summariesFolder,
            filenameHint: "note",
            content: "x",
          },
        ],
      }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-permission-denied");
    // Nothing was persisted.
    expect(
      await countFiles(path.join(vaultRoot, "00_Inbox", "agentic-os", "summaries")),
    ).toBe(0);
  });

  it("fails closed when an event output lacks the event-emit permission", async () => {
    const emitSpy = vi.spyOn(bus, "emit");
    const m = mission({
      id: "x",
      permissions: [],
      run: async () => ({
        status: "success",
        outputs: [{ kind: "event", eventKind: "test.evt", payload: {} }],
      }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-permission-denied");
    expect(emitSpy.mock.calls.filter((c) => c[0].kind === "test.evt")).toHaveLength(0);
  });
});

describe("runMission — output persistence", () => {
  it("persists a vault-note output through the constrained writer only", async () => {
    const secret = "/home/operator/.secrets/success-token-4ad9";
    const m = mission({
      id: "x",
      permissions: ["vault-write"],
      run: async () => ({
        status: "success",
        message: secret,
        outputs: [
          {
            kind: "vault-note",
            outputFolder: summariesFolder,
            filenameHint: "runner-note",
            content: "# Runner\n\nbody",
          },
        ],
      }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("success");
    if (r.status !== "success") throw new Error("unreachable");
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain("success-token-4ad9");
    expect(r.outputs).toHaveLength(1);
    const ref = r.outputs[0]!;
    expect(ref.kind).toBe("vault-note");
    expect(ref.path!.startsWith("00_Inbox/agentic-os/summaries/")).toBe(true);
    // The note carries the constrained-writer frontmatter fingerprint.
    const text = await fs.readFile(path.join(vaultRoot, ref.path!), "utf8");
    expect(text).toContain("mission: x");
    expect(text).toContain("body");
  });

  it("emits an event output through the bus only — no filesystem write", async () => {
    const emitSpy = vi.spyOn(bus, "emit");
    const m = mission({
      id: "x",
      permissions: ["event-emit"],
      run: async () => ({
        status: "success",
        outputs: [
          { kind: "event", eventKind: "mission.test.evt", payload: { a: 1 } },
        ],
      }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("success");
    if (r.status !== "success") throw new Error("unreachable");
    const calls = emitSpy.mock.calls.filter((c) => c[0].kind === "mission.test.evt");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].source).toBe("scheduler");
    expect(
      await countFiles(path.join(vaultRoot, "00_Inbox", "agentic-os", "summaries")),
    ).toBe(0);
  });
});

describe("runMission — failure modes", () => {
  it("returns a neutral failure when run() throws", async () => {
    const m = mission({
      id: "x",
      run: async () => {
        throw new Error("/secret/path leaked in stack");
      },
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-threw");
    expect(JSON.stringify(r)).not.toContain("/secret/path");
  });

  it("persists nothing for a skipped result", async () => {
    const m = mission({
      id: "x",
      run: async () => ({ status: "skipped", reason: "not needed" }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("skipped");
    if (r.status !== "skipped") throw new Error("unreachable");
    expect(r.outputs).toHaveLength(0);
  });

  it("does not echo a skipped mission's raw reason", async () => {
    const secret = "/home/operator/.secrets/token-9f3a2b";
    const m = mission({
      id: "x",
      run: async () => ({ status: "skipped", reason: secret }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("skipped");
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain("token-9f3a2b");
  });
});

describe("runMission — capability gating", () => {
  it("denies ctx.caps.invoke for a mission without the external-api permission", async () => {
    let invokeResult: CapabilityInvokeResult | undefined;
    const m = mission({
      id: "x",
      permissions: [],
      run: async (ctx) => {
        invokeResult = await ctx.caps.invoke("web.fetch", {});
        return { status: "success" };
      },
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("success");
    expect(invokeResult?.status).toBe("failed");
    expect(invokeResult?.errorCode).toBe("permission-denied");
  });
});

describe("runMission — partial-failure audit", () => {
  it("audits the actual persisted count when a later output write fails", async () => {
    const m = mission({
      id: "x",
      permissions: ["vault-write"],
      run: async () => ({
        status: "success",
        outputs: [
          {
            kind: "vault-note",
            outputFolder: summariesFolder,
            filenameHint: "ok",
            content: "first",
          },
          {
            // A non-allowlisted folder — the constrained writer
            // rejects the SECOND output after the first persisted.
            kind: "vault-note",
            outputFolder: "00_Inbox/agentic-os/nope" as unknown as VaultRelativePath,
            filenameHint: "bad",
            content: "second",
          },
        ],
      }),
    });
    const r = await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    expect(r.status).toBe("failed");
    if (r.status !== "failed") throw new Error("unreachable");
    expect(r.errorClass).toBe("mission-output-write-failed");

    const day = new Date().toISOString().slice(0, 10);
    const raw = await fs.readFile(path.join(auditDir, `${day}.jsonl`), "utf8");
    const runs = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.kind === "mission.run");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.outputsPersisted).toBe(1);
  });
});

describe("runMission — audit", () => {
  it("writes exactly one neutral mission.run audit entry per run", async () => {
    const m = mission({
      id: "x",
      permissions: ["vault-write"],
      run: async () => ({
        status: "success",
        outputs: [
          {
            kind: "vault-note",
            outputFolder: summariesFolder,
            filenameHint: "audited",
            content: "x",
          },
        ],
      }),
    });
    await runMission(
      { missionId: "x", trigger: "manual", rawOptions: {} },
      { registry: registryWith(m), config },
    );
    const day = new Date().toISOString().slice(0, 10);
    const raw = await fs.readFile(path.join(auditDir, `${day}.jsonl`), "utf8");
    const entries = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const runs = entries.filter((e) => e.kind === "mission.run");
    expect(runs).toHaveLength(1);
    const entry = runs[0]!;
    expect(entry.missionId).toBe("x");
    expect(entry.status).toBe("success");
    expect(entry.outputsPersisted).toBe(1);
    // No paths / options / content in the audit line.
    expect(JSON.stringify(entry)).not.toContain("00_Inbox");
  });
});
