// Scheduler status endpoint (Phase 1C — M1 gated).
//
// The route is gated behind the scheduler feature (mode "enabled"):
// disabled → 404, enabled → snapshot. loadConfig() is pointed at a
// temp config; two config files cover the enabled / disabled cases.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../src/features/scheduler/runtime", () => ({
  getGlobalMissionSchedulerSnapshot: () => ({
    status: "running",
    scheduled: [{ missionId: "daily-summary", cron: "0 20 * * *", timezone: "UTC" }],
    diagnostics: [],
  }),
}));

import { GET } from "../src/app/api/scheduler/status/route";

let tmpDir: string;
let enabledConfig: string;
let disabledConfig: string;
let originalConfigEnv: string | undefined;
let originalVaultEnv: string | undefined;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-sched-status-"));
  const vaultRoot = path.join(tmpDir, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });

  enabledConfig = path.join(tmpDir, "enabled.yaml");
  disabledConfig = path.join(tmpDir, "disabled.yaml");
  await fs.writeFile(
    enabledConfig,
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
  delete process.env.AGENTIC_OS_VAULT;
  process.env.AGENTIC_OS_CONFIG = enabledConfig;
});

afterAll(async () => {
  if (originalConfigEnv === undefined) delete process.env.AGENTIC_OS_CONFIG;
  else process.env.AGENTIC_OS_CONFIG = originalConfigEnv;
  if (originalVaultEnv === undefined) delete process.env.AGENTIC_OS_VAULT;
  else process.env.AGENTIC_OS_VAULT = originalVaultEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/scheduler/status", {
    headers,
  });
}

describe("GET /api/scheduler/status", () => {
  it("returns a neutral scheduler snapshot when the feature is enabled", async () => {
    process.env.AGENTIC_OS_CONFIG = enabledConfig;
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      scheduler: {
        status: "running",
        scheduled: [{ missionId: "daily-summary", cron: "0 20 * * *", timezone: "UTC" }],
        diagnostics: [],
      },
    });
  });

  it("returns 404 when the scheduler feature is disabled", async () => {
    process.env.AGENTIC_OS_CONFIG = disabledConfig;
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("rejects cross-origin requests with 403", async () => {
    process.env.AGENTIC_OS_CONFIG = enabledConfig;
    const res = await GET(req({ origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });
});
