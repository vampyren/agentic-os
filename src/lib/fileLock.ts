// Per-absolute-path in-process file lock (M4a — PR3b extraction).
//
// Serializes a critical section per resolved path by chaining promises in an
// in-process map. Single-process scope only — matches the deployment model
// (one local Next.js process). The map entry is cleared once its chain
// drains so it doesn't leak across many distinct files over a long session.
//
// Existing callers: src/vault/writer.ts (appendJournalEntry / updateFrontmatter)
// and src/kernel/config/writeConfig.ts (PR3b connector-config writes).

import path from "node:path";

const fileLocks = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(
  absPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(absPath);
  const prev = fileLocks.get(key) ?? Promise.resolve();
  // `.catch(() => {})` keeps the chain non-poisoning: a previous caller's
  // failure must not block subsequent callers.
  const run = prev.catch(() => {}).then(fn);
  fileLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (fileLocks.get(key) === run) fileLocks.delete(key);
  }
}
