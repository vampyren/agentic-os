import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { POST } from "../src/app/api/missions/[id]/run/route";
import { missionRegistry } from "../src/features/scheduler/missions/registry";
import type {
  MissionDefinition,
  MissionRunResult,
} from "../src/features/scheduler/missions/types";
import { toVaultRelativePath } from "../src/lib/vaultPaths";

// The route uses the global mission registry + loadConfig(). vitest
// isolates modules per test file, so the global registry is fresh
// here; we register one mission and point the config loader at a
// temp vault.

let tmpDir: string;
let vaultRoot: string;
let configFile: string;
let disabledConfig: string;
let originalConfigEnv: string | undefined;
let originalVaultEnv: string | undefined;
let originalAuditEnv: string | undefined;

const summariesFolder = toVaultRelativePath("00_Inbox/agentic-os/summaries");
const SUCCESS_SECRET = "/home/operator/.secrets/success-token-19d4";

const routeMission: MissionDefinition = {
  id: "route-mission",
  title: "Route Mission",
  description: "test",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "single",
  outputKind: "custom",
  optionsSchema: z.object({}).strict(),
  permissions: ["vault-write"],
  run: async (): Promise<MissionRunResult> => ({
    status: "success",
    message: SUCCESS_SECRET,
    outputs: [
      {
        kind: "vault-note",
        outputFolder: summariesFolder,
        filenameHint: "route-note",
        content: "# Route\n\nbody",
      },
    ],
  }),
};

// A mission that skips with a secret-like reason — used to prove the
// API never echoes mission-controlled skipped text.
const SKIP_SECRET = "/home/operator/.secrets/api-token-7c2e";
const skipMission: MissionDefinition = {
  id: "skip-mission",
  title: "Skip Mission",
  description: "test",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "single",
  outputKind: "custom",
  optionsSchema: z.object({}).strict(),
  permissions: [],
  run: async (): Promise<MissionRunResult> => ({
    status: "skipped",
    reason: SKIP_SECRET,
  }),
};

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-missions-"));
  vaultRoot = path.join(tmpDir, "vault");
  await fs.mkdir(path.join(vaultRoot, "00_Inbox", "agentic-os"), {
    recursive: true,
  });
  configFile = path.join(tmpDir, "config.yaml");
  disabledConfig = path.join(tmpDir, "config-disabled.yaml");
  // M1: the manual mission-run route is gated behind the scheduler
  // feature, so the default test config must enable it — otherwise the
  // gate would 404 every run. A second config keeps the feature
  // disabled, to prove the gate fails closed.
  await fs.writeFile(
    configFile,
    `vault:\n  root: ${vaultRoot}\nfeatures:\n  scheduler:\n    enabled: true\n`,
    "utf8",
  );
  await fs.writeFile(
    disabledConfig,
    `vault:\n  root: ${vaultRoot}\nfeatures:\n  scheduler:\n    enabled: false\n`,
    "utf8",
  );

  originalConfigEnv = process.env.AGENTIC_OS_CONFIG;
  originalVaultEnv = process.env.AGENTIC_OS_VAULT;
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_CONFIG = configFile;
  delete process.env.AGENTIC_OS_VAULT;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");

  missionRegistry.register(routeMission);
  missionRegistry.register(skipMission);
});

afterAll(async () => {
  if (originalConfigEnv === undefined) delete process.env.AGENTIC_OS_CONFIG;
  else process.env.AGENTIC_OS_CONFIG = originalConfigEnv;
  if (originalVaultEnv === undefined) delete process.env.AGENTIC_OS_VAULT;
  else process.env.AGENTIC_OS_VAULT = originalVaultEnv;
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function post(
  id: string,
  body: string | undefined,
  headers: Record<string, string> = {},
): Promise<Response> {
  const req = new Request(`http://127.0.0.1:3000/api/missions/${id}/run`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body } : {}),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe("POST /api/missions/[id]/run", () => {
  it("rejects a cross-origin request with 403", async () => {
    const res = await post("route-mission", "{}", {
      origin: "http://evil.example",
    });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed percent-escaped mission id with 400", async () => {
    const res = await post("%ZZ", "{}");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errorClass).toBe("mission-id-malformed");
  });

  it("returns 404 for an unknown mission", async () => {
    const res = await post("ghost-mission", "{}");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.errorClass).toBe("mission-unknown");
  });

  it("returns 400 for an invalid JSON body", async () => {
    const res = await post("route-mission", "{bad json");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errorClass).toBe("invalid-json");
  });

  it("returns 400 for an unknown top-level body key", async () => {
    const res = await post("route-mission", JSON.stringify({ foo: 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errorClass).toBe("invalid-body");
  });

  it("returns 400 when options is not a plain object", async () => {
    const res = await post("route-mission", JSON.stringify({ options: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errorClass).toBe("invalid-body");
  });

  it("returns 400 with a neutral body for invalid mission options", async () => {
    const res = await post(
      "route-mission",
      JSON.stringify({ options: { sneaky: "leak-me" } }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errorClass).toBe("mission-options-invalid");
    expect(JSON.stringify(json)).not.toContain("leak-me");
    expect(JSON.stringify(json)).not.toContain("sneaky");
  });

  it("runs the mission and returns a neutral success body", async () => {
    const res = await post("route-mission", JSON.stringify({ options: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("success");
    expect(JSON.stringify(json)).not.toContain(SUCCESS_SECRET);
    expect(JSON.stringify(json)).not.toContain("success-token-19d4");
    expect(typeof json.runId).toBe("string");
    expect(json.outputs).toHaveLength(1);
    expect(json.outputs[0].kind).toBe("vault-note");
    expect(json.outputs[0].path.startsWith("00_Inbox/agentic-os/summaries/")).toBe(
      true,
    );
  });

  it("reaches a built-in mission without test-only registration", async () => {
    // daily-summary is never manually registered here — the route's
    // ensureBuiltinMissions() wiring must make it runnable.
    const res = await post("daily-summary", JSON.stringify({ options: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.missionId).toBe("daily-summary");
  });

  it("does not echo a skipped mission's raw reason", async () => {
    const res = await post("skip-mission", JSON.stringify({ options: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("skipped");
    expect(JSON.stringify(json)).not.toContain(SKIP_SECRET);
    expect(JSON.stringify(json)).not.toContain("api-token-7c2e");
  });

  it("returns 404 when the scheduler feature is disabled by config", async () => {
    // The scheduler feature gate fails closed: with the feature
    // disabled in config, a manual run of an OTHERWISE-RUNNABLE,
    // registered mission must 404 — the gate fires before mission
    // lookup, so route-mission (which 200s when enabled) cannot run.
    process.env.AGENTIC_OS_CONFIG = disabledConfig;
    try {
      const res = await post("route-mission", JSON.stringify({ options: {} }));
      expect(res.status).toBe(404);
    } finally {
      process.env.AGENTIC_OS_CONFIG = configFile;
    }
  });
});
