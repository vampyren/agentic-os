// Shell feature resolution (Phase 1C — M2).
//
// The shell renders on every page. resolveShellFeatures MUST NOT throw
// when the operator config is missing — otherwise every page 500s
// (the regression that broke the e2e webserver health-check).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveShellFeatures } from "../src/app/_lib/shellFeatures";

let tmpDir: string;
let originalConfigEnv: string | undefined;
let originalVaultEnv: string | undefined;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shell-features-"));
  originalConfigEnv = process.env.AGENTIC_OS_CONFIG;
  originalVaultEnv = process.env.AGENTIC_OS_VAULT;
  delete process.env.AGENTIC_OS_VAULT;
});

afterAll(async () => {
  if (originalConfigEnv === undefined) delete process.env.AGENTIC_OS_CONFIG;
  else process.env.AGENTIC_OS_CONFIG = originalConfigEnv;
  if (originalVaultEnv === undefined) delete process.env.AGENTIC_OS_VAULT;
  else process.env.AGENTIC_OS_VAULT = originalVaultEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveShellFeatures", () => {
  it("returns an empty list when the config is missing — never throws", async () => {
    process.env.AGENTIC_OS_CONFIG = path.join(tmpDir, "does-not-exist.yaml");
    await expect(resolveShellFeatures()).resolves.toEqual([]);
  });

  it("resolves the registered features when the config loads", async () => {
    const vault = path.join(tmpDir, "vault");
    await fs.mkdir(vault, { recursive: true });
    const configFile = path.join(tmpDir, "config.yaml");
    await fs.writeFile(configFile, `vault:\n  root: ${vault}\n`, "utf8");
    process.env.AGENTIC_OS_CONFIG = configFile;

    const features = await resolveShellFeatures();
    expect(features.some((f) => f.id === "scheduler")).toBe(true);
  });
});
