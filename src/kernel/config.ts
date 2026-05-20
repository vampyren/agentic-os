// Config loader. Reads ~/.agentic-os/config.yaml (per ADR-0007, Phase 1A
// canonical config path). Env overrides for two keys:
//   AGENTIC_OS_CONFIG → custom config file path
//   AGENTIC_OS_VAULT  → override vault.root
//
// If config is missing or invalid, the kernel refuses to start with a clear
// error pointing at the file. No silent defaults for vault.root — that path
// is operator-specific.
//
// Phase 1C / M1: the config gained a `configVersion` field and several
// optional sections (features, connectors, mcpServers, permissions) — see
// schemas/appConfig.ts. `configVersion` is forward-guarded here, before
// schema validation, so the operator gets a tailored error.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import {
  appConfigSchema,
  SUPPORTED_CONFIG_VERSION,
  type AppConfig,
} from "./schemas/appConfig";

export function configPath(): string {
  return process.env.AGENTIC_OS_CONFIG
    ?? path.join(os.homedir(), ".agentic-os", "config.yaml");
}

/**
 * Forward guard for `configVersion`. Runs before schema validation so the
 * operator gets a precise message rather than a generic zod literal error.
 *
 * Rules: ONLY a truly-absent key (`undefined`) is treated as the supported
 * version; exactly the supported version → OK; anything else — a higher
 * version, or any malformed value (`null`, boolean, array, object, "1",
 * 0, 1.5, negative) → refuse to start. An explicit `configVersion: null`
 * in YAML (an empty value) is NOT "absent": it is a malformed value and
 * must surface the tailored error, not be silently accepted.
 */
function assertSupportedConfigVersion(raw: unknown, file: string): void {
  if (raw === undefined) return; // key truly absent → treated as v1
  if (raw === SUPPORTED_CONFIG_VERSION) return;

  if (typeof raw === "number" && Number.isInteger(raw) && raw > SUPPORTED_CONFIG_VERSION) {
    throw new Error(
      `Agentic OS config at ${file} declares configVersion ${raw}, but this ` +
      `build only supports configVersion ${SUPPORTED_CONFIG_VERSION}. ` +
      `Upgrade Agentic OS to load this config.`,
    );
  }

  throw new Error(
    `Agentic OS config at ${file} has an invalid configVersion ` +
    `(${JSON.stringify(raw)}). Expected the integer ${SUPPORTED_CONFIG_VERSION}, ` +
    `or omit the field entirely.`,
  );
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

  // Forward guard before schema validation — tailored error messaging.
  const rawVersion =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["configVersion"]
      : undefined;
  assertSupportedConfigVersion(rawVersion, p);

  const result = appConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Agentic OS config at ${p} failed validation: ${result.error.message}`);
  }

  // Env override for vault root. Spread the rest of the parsed config so
  // the new sections (features / connectors / mcpServers / permissions)
  // and their applied defaults are preserved.
  const cfg: AppConfig = {
    ...result.data,
    vault: { root: process.env.AGENTIC_OS_VAULT ?? result.data.vault.root },
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
