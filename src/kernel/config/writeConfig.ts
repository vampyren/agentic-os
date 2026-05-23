// Atomic config writer (M4a — PR3b, spec §14 / req 3).
//
// Used by POST /api/connectors and any future config-mutating route. The
// write is sequenced per resolved config path via the shared in-process file
// lock (src/lib/fileLock.ts) so concurrent route calls cannot interleave.
//
// Write protocol:
//   1. validate the proposed AppConfig through appConfigSchema (defense in
//      depth — the caller has likely already validated);
//   2. back up the current config to `<path>.bak` (if it exists) so a botched
//      write leaves a recoverable copy;
//   3. write to a temp file (`<path>.tmp-<pid>-<ts>`) with mode 0600,
//      `fsync` it, then `rename` atomically over the destination;
//   4. on any failure, the temp file is best-effort removed and the original
//      stays put.
//
// The response surface NEVER echoes raw YAML, raw `settings`, secrets, or
// the resolved authRef value — that contract lives in the route handlers.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { withFileLock } from "@/lib/fileLock";
import { configPath } from "../config";
import { appConfigSchema, type AppConfig } from "../schemas/appConfig";

export async function writeConfig(newConfig: AppConfig): Promise<void> {
  const validated = appConfigSchema.parse(newConfig);
  const filePath = configPath();
  await withFileLock(filePath, async () => {
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
      // Best-effort cleanup; the original config (and the .bak) stay put.
      try { await fs.rm(tempPath, { force: true }); } catch { /* ignore */ }
      throw err;
    }
  });
}
