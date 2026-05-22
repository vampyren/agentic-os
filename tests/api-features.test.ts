// Feature projection endpoint (Phase 1C — M1).
//
// Integration test for GET /api/features against a temp config that
// enables the scheduler, so the registered Scheduler feature resolves
// to "ready" and appears in the UI-safe projection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as featuresRoute from "../src/app/api/features/route";

let tmpDir: string;
let originalConfigEnv: string | undefined;
let originalVaultEnv: string | undefined;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-features-"));
  const vaultRoot = path.join(tmpDir, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const configFile = path.join(tmpDir, "config.yaml");
  await fs.writeFile(
    configFile,
    `vault:\n  root: ${vaultRoot}\nfeatures:\n  scheduler:\n    enabled: true\n`,
    "utf8",
  );

  originalConfigEnv = process.env.AGENTIC_OS_CONFIG;
  originalVaultEnv = process.env.AGENTIC_OS_VAULT;
  process.env.AGENTIC_OS_CONFIG = configFile;
  delete process.env.AGENTIC_OS_VAULT;
});

afterAll(async () => {
  if (originalConfigEnv === undefined) delete process.env.AGENTIC_OS_CONFIG;
  else process.env.AGENTIC_OS_CONFIG = originalConfigEnv;
  if (originalVaultEnv === undefined) delete process.env.AGENTIC_OS_VAULT;
  else process.env.AGENTIC_OS_VAULT = originalVaultEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function get(): Promise<Response> {
  return featuresRoute.GET(
    new Request("http://127.0.0.1:3000/api/features"),
  );
}

describe("GET /api/features", () => {
  it("returns 200 with shape { features: [...] }", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.features)).toBe(true);
  });

  it("lists the Scheduler feature with status.state === ready", async () => {
    const json = await (await get()).json();
    const scheduler = json.features.find(
      (f: { id: string }) => f.id === "scheduler",
    );
    expect(scheduler).toBeDefined();
    expect(scheduler.status.state).toBe("ready");
  });

  it("never exposes config, health, schemas or filesystem paths", async () => {
    const json = await (await get()).json();
    const scheduler = json.features.find(
      (f: { id: string }) => f.id === "scheduler",
    );
    expect(scheduler.config).toBeUndefined();
    expect(scheduler.health).toBeUndefined();
    expect(scheduler.vault).toBeUndefined();

    const body = JSON.stringify(json);
    expect(body).not.toContain("/home/");
    expect(body).not.toContain("/Users/");
    expect(body).not.toContain("C:\\");
  });

  it("rejects a cross-origin request with 403", async () => {
    const res = await featuresRoute.GET(
      new Request("http://127.0.0.1:3000/api/features", {
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("exports only GET — any other method gets Next's automatic 405", () => {
    expect(typeof featuresRoute.GET).toBe("function");
    expect(
      (featuresRoute as Record<string, unknown>).POST,
    ).toBeUndefined();
  });
});
