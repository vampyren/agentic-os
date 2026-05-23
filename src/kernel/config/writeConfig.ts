// Atomic config writer (M4a — PR3b, spec §14 / req 3).
//
// Two public entry points, both lock per resolved config path via the shared
// in-process file lock (src/lib/fileLock.ts):
//
//   writeConfig(newConfig)          — full replacement; the caller already
//                                     holds the canonical proposed config.
//   updateConfig(mutator)           — locked READ-MODIFY-WRITE. Reads the
//                                     on-disk config (NOT loadConfig — env
//                                     overrides are not applied so a runtime
//                                     override of vault.root cannot get
//                                     persisted), runs the mutator, validates,
//                                     and commits. Use this for any flow that
//                                     mutates one field while preserving the
//                                     rest of the file (the connector-add
//                                     POST, future settings edits, etc).
//
// Commit protocol (both entry points):
//   1. validate the proposed AppConfig through appConfigSchema;
//   2. back up the current config to `<path>.bak` (if it exists);
//   3. write to a temp file (`<path>.tmp-<pid>-<ts>`) with mode 0600,
//      `fsync` it, then `rename` atomically over the destination;
//   4. on any failure, the temp file is best-effort removed and the
//      original stays put.
//
// The response surface NEVER echoes raw YAML, raw `settings`, secrets, or
// the resolved authRef value — that contract lives in the route handlers.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { withFileLock } from "@/lib/fileLock";
import { configPath, readConfigFile } from "../config";
import { appConfigSchema, type AppConfig } from "../schemas/appConfig";

/** No lock — callers MUST hold it (used by both public entry points below). */
async function writeConfigUnlocked(
  filePath: string,
  validated: AppConfig,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    await fs.copyFile(filePath, `${filePath}.bak`);
  }
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const yamlText = YAML.stringify(validated);
  try {
    const fh = await fs.open(tempPath, "w", 0o600);
    try {
      await fh.writeFile(yamlText, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tempPath, filePath);
  } catch (err) {
    try { await fs.rm(tempPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/** Replace the whole config atomically. Used when the caller has the new
 *  config in hand; for read-modify-write, prefer {@link updateConfig}. */
export async function writeConfig(newConfig: AppConfig): Promise<void> {
  const validated = appConfigSchema.parse(newConfig);
  const filePath = configPath();
  await withFileLock(filePath, () =>
    writeConfigUnlocked(filePath, validated),
  );
}

/**
 * Lock-bracketed read-modify-write. The mutator sees the FRESH on-disk
 * config (no env overrides applied — `vault.root` from `AGENTIC_OS_VAULT`
 * is a runtime concern that must never be persisted). The whole load →
 * check → write happens under one file-lock hold, so two concurrent
 * mutators cannot interleave and silently overwrite each other.
 *
 * The mutator may throw to signal an early-return — e.g. a duplicate-id
 * check — and nothing will be written. Re-throw is what the route handler
 * maps to its specific HTTP code.
 */
export async function updateConfig(
  mutator: (current: AppConfig) => AppConfig | Promise<AppConfig>,
): Promise<AppConfig> {
  const filePath = configPath();
  return withFileLock(filePath, async () => {
    const current = await readConfigFile(filePath);
    const proposed = await mutator(current);
    const validated = appConfigSchema.parse(proposed);
    await writeConfigUnlocked(filePath, validated);
    return validated;
  });
}
