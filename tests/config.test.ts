import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { loadConfig } from "../src/kernel/config";
import { SUPPORTED_CONFIG_VERSION } from "../src/kernel/schemas/appConfig";

// Isolation pattern (mirrors tests/agentCwd.test.ts):
//   - A fresh tmp dir per test. It doubles as BOTH the directory holding
//     config.yaml AND the `vault.root` target — loadConfig() stats
//     vault.root and needs it to be a real directory.
//   - AGENTIC_OS_CONFIG points the loader at the tmp config file.
//   - AGENTIC_OS_VAULT is cleared by default (some tests set it) and
//     restored afterward so tests don't leak into each other.

let tmpDir: string;
let configFile: string;
let originalConfigEnv: string | undefined;
let originalVaultEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
  configFile = path.join(tmpDir, "config.yaml");
  originalConfigEnv = process.env.AGENTIC_OS_CONFIG;
  originalVaultEnv = process.env.AGENTIC_OS_VAULT;
  process.env.AGENTIC_OS_CONFIG = configFile;
  delete process.env.AGENTIC_OS_VAULT;
});

afterEach(async () => {
  if (originalConfigEnv === undefined) delete process.env.AGENTIC_OS_CONFIG;
  else process.env.AGENTIC_OS_CONFIG = originalConfigEnv;
  if (originalVaultEnv === undefined) delete process.env.AGENTIC_OS_VAULT;
  else process.env.AGENTIC_OS_VAULT = originalVaultEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write a config.yaml into the tmp dir for the loader to pick up. */
async function writeConfig(yaml: string): Promise<void> {
  await fs.writeFile(configFile, yaml, "utf8");
}

describe("loadConfig — backward compatibility", () => {
  it("loads a v0.2.12-shaped config (vault + agents only, no configVersion)", async () => {
    await writeConfig(`vault:\n  root: ${tmpDir}\nagents:\n  default: claude-code\n`);
    const cfg = await loadConfig();
    expect(cfg.vault.root).toBe(tmpDir);
    expect(cfg.agents.default).toBe("claude-code");
    // Absent configVersion is treated as the supported version.
    expect(cfg.configVersion).toBe(SUPPORTED_CONFIG_VERSION);
  });

  it("loads a config with an explicit configVersion: 1", async () => {
    await writeConfig(`configVersion: 1\nvault:\n  root: ${tmpDir}\n`);
    const cfg = await loadConfig();
    expect(cfg.configVersion).toBe(1);
  });

  it("loads a config with no agents section (agents defaults to {})", async () => {
    await writeConfig(`vault:\n  root: ${tmpDir}\n`);
    const cfg = await loadConfig();
    expect(cfg.agents.default).toBeUndefined();
  });
});

describe("loadConfig — configVersion forward guard", () => {
  it("refuses a configVersion higher than supported", async () => {
    await writeConfig(`configVersion: 2\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/configVersion 2/);
    await expect(loadConfig()).rejects.toThrow(/[Uu]pgrade/);
  });

  it("rejects configVersion 0 as invalid", async () => {
    await writeConfig(`configVersion: 0\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects a negative configVersion as invalid", async () => {
    await writeConfig(`configVersion: -1\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects a non-integer configVersion as invalid", async () => {
    await writeConfig(`configVersion: 1.5\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects a stringy configVersion as invalid", async () => {
    await writeConfig(`configVersion: "1"\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects an explicit null configVersion as invalid (null is NOT 'absent')", async () => {
    // `configVersion:` with an empty value parses to YAML null. The locked
    // rule: only a truly-absent key is treated as v1. An explicit null is
    // a malformed value and must surface the tailored error.
    await writeConfig(`configVersion: null\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects an empty-value configVersion (bare `configVersion:`) as invalid", async () => {
    // `configVersion:` with nothing after the colon also parses to null.
    await writeConfig(`configVersion:\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects a boolean configVersion as invalid", async () => {
    await writeConfig(`configVersion: true\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects an array configVersion as invalid", async () => {
    await writeConfig(`configVersion: [1]\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });

  it("rejects an object configVersion as invalid", async () => {
    await writeConfig(`configVersion:\n  nested: 1\nvault:\n  root: ${tmpDir}\n`);
    await expect(loadConfig()).rejects.toThrow(/invalid configVersion/i);
  });
});

describe("loadConfig — default sections", () => {
  it("applies safe defaults for every new section when none are present", async () => {
    await writeConfig(`vault:\n  root: ${tmpDir}\n`);
    const cfg = await loadConfig();

    expect(cfg.features.scheduler.enabled).toBe(false);
    expect(cfg.features.scheduler.missions).toEqual({});
    expect(cfg.connectors).toEqual({});
    expect(cfg.mcpServers).toEqual({});
    expect(cfg.permissions.defaults).toEqual({
      externalApi: "prompt",
      localProcess: "deny",
      vaultWrite: "inbox-only",
      network: "deny-localhost-private",
    });
  });

  it("fills scheduler defaults when features is present but scheduler is absent", async () => {
    await writeConfig(`vault:\n  root: ${tmpDir}\nfeatures: {}\n`);
    const cfg = await loadConfig();
    expect(cfg.features.scheduler.enabled).toBe(false);
    expect(cfg.features.scheduler.missions).toEqual({});
  });

  it("fills per-field permission defaults when permissions.defaults is partial", async () => {
    await writeConfig(
      `vault:\n  root: ${tmpDir}\n` +
      `permissions:\n  defaults:\n    externalApi: allow\n`,
    );
    const cfg = await loadConfig();
    // The explicitly set field wins.
    expect(cfg.permissions.defaults.externalApi).toBe("allow");
    // The omitted fields still get safe defaults.
    expect(cfg.permissions.defaults.localProcess).toBe("deny");
    expect(cfg.permissions.defaults.vaultWrite).toBe("inbox-only");
    expect(cfg.permissions.defaults.network).toBe("deny-localhost-private");
  });

  it("preserves an explicit scheduler.enabled: true", async () => {
    await writeConfig(
      `vault:\n  root: ${tmpDir}\n` +
      `features:\n  scheduler:\n    enabled: true\n`,
    );
    const cfg = await loadConfig();
    expect(cfg.features.scheduler.enabled).toBe(true);
  });
});

describe("loadConfig — strict validation", () => {
  it("rejects an unknown top-level key", async () => {
    await writeConfig(`vault:\n  root: ${tmpDir}\nbogusTopLevel: 1\n`);
    await expect(loadConfig()).rejects.toThrow(/failed validation/i);
  });

  it("rejects an unknown key inside permissions.defaults", async () => {
    await writeConfig(
      `vault:\n  root: ${tmpDir}\n` +
      `permissions:\n  defaults:\n    bogusPermission: nope\n`,
    );
    await expect(loadConfig()).rejects.toThrow(/failed validation/i);
  });

  it("rejects an unknown key inside features.scheduler", async () => {
    await writeConfig(
      `vault:\n  root: ${tmpDir}\n` +
      `features:\n  scheduler:\n    bogusField: 1\n`,
    );
    await expect(loadConfig()).rejects.toThrow(/failed validation/i);
  });
});

describe("loadConfig — vault.root", () => {
  it("rejects a config with no vault section", async () => {
    await writeConfig(`agents:\n  default: claude-code\n`);
    await expect(loadConfig()).rejects.toThrow(/failed validation/i);
  });

  it("rejects a vault.root that points at a file, not a directory", async () => {
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    await fs.writeFile(filePath, "x", "utf8");
    await writeConfig(`vault:\n  root: ${filePath}\n`);
    await expect(loadConfig()).rejects.toThrow(/not a directory|not a readable directory/i);
  });

  it("rejects a vault.root that does not exist", async () => {
    const ghost = path.join(tmpDir, "does-not-exist");
    await writeConfig(`vault:\n  root: ${ghost}\n`);
    await expect(loadConfig()).rejects.toThrow(/not a readable directory/i);
  });
});

describe("loadConfig — AGENTIC_OS_VAULT override", () => {
  it("overrides vault.root with AGENTIC_OS_VAULT when set", async () => {
    const altVault = await fs.mkdtemp(path.join(os.tmpdir(), "alt-vault-"));
    try {
      // Config points at a bogus path; the env override should win.
      await writeConfig(`vault:\n  root: /nonexistent/in/config\n`);
      process.env.AGENTIC_OS_VAULT = altVault;
      const cfg = await loadConfig();
      expect(cfg.vault.root).toBe(altVault);
    } finally {
      await fs.rm(altVault, { recursive: true, force: true });
    }
  });

  it("keeps the new sections intact when the vault override is applied", async () => {
    const altVault = await fs.mkdtemp(path.join(os.tmpdir(), "alt-vault-"));
    try {
      await writeConfig(
        `vault:\n  root: ${tmpDir}\n` +
        `features:\n  scheduler:\n    enabled: true\n`,
      );
      process.env.AGENTIC_OS_VAULT = altVault;
      const cfg = await loadConfig();
      expect(cfg.vault.root).toBe(altVault);
      // The override must not clobber the rest of the parsed config.
      expect(cfg.features.scheduler.enabled).toBe(true);
      expect(cfg.permissions.defaults.vaultWrite).toBe("inbox-only");
    } finally {
      await fs.rm(altVault, { recursive: true, force: true });
    }
  });
});

describe("loadConfig — error surfaces", () => {
  it("throws a clear error when the config file is missing", async () => {
    // No writeConfig() call — the file does not exist.
    await expect(loadConfig()).rejects.toThrow(/config not found/i);
  });

  it("throws a clear error when the config file is not valid YAML", async () => {
    await writeConfig("vault:\n  root: [unclosed\n");
    await expect(loadConfig()).rejects.toThrow(/not valid YAML/i);
  });
});
