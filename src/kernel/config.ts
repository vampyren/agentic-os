// Config loader. Reads ~/.agentic-os/config.yaml (per ADR-0007, Phase 1A
// canonical config path). Env overrides for two keys:
//   AGENTIC_OS_CONFIG → custom config file path
//   AGENTIC_OS_VAULT  → override vault.root
//
// If config is missing or invalid, the kernel refuses to start with a clear
// error pointing at the file. No silent defaults for vault.root — that path
// is operator-specific.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import { z } from "zod";
import type { AppConfig } from "./types";

const configSchema = z.object({
  vault: z.object({
    root: z.string().min(1, "vault.root is required"),
  }),
  agents: z.object({
    default: z.string().optional(),
  }).optional().default({}),
});

export function configPath(): string {
  return process.env.AGENTIC_OS_CONFIG
    ?? path.join(os.homedir(), ".agentic-os", "config.yaml");
}

export async function loadConfig(): Promise<AppConfig> {
  const p = configPath();
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    throw new Error(
      `Agentic OS config not found at ${p}. ` +
      `Create it per docs/INSTALL.md → Phase 1A manual install. ` +
      `Underlying error: ${String(e)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    throw new Error(`Agentic OS config at ${p} is not valid YAML: ${String(e)}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Agentic OS config at ${p} failed validation: ${result.error.message}`);
  }

  // Env override for vault root.
  const cfg: AppConfig = {
    vault: { root: process.env.AGENTIC_OS_VAULT ?? result.data.vault.root },
    agents: { default: result.data.agents?.default },
  };

  // Final sanity: vault root must exist as a directory.
  try {
    const st = await fs.stat(cfg.vault.root);
    if (!st.isDirectory()) {
      throw new Error(`vault.root (${cfg.vault.root}) exists but is not a directory`);
    }
  } catch (e) {
    throw new Error(`vault.root (${cfg.vault.root}) is not a readable directory: ${String(e)}`);
  }

  return cfg;
}
