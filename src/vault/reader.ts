// Vault reader. Phase 1B basic walker — list/read notes under
// `<vaultRoot>/00_Inbox/agentic-os/<kind>/`. Phase 1B commit 4 expands this
// to walk the whole vault and feed the FTS5 index.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", "60_Attachments"]);

export interface ParsedNote {
  path: string;                         // relative to vault root
  absolutePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtime: number;
}

function assertUnderRoot(absPath: string, vaultRoot: string): void {
  const resolved = path.resolve(absPath);
  const root = path.resolve(vaultRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path ${resolved} is outside vault root ${root}`);
  }
}

export async function readNote(vaultRoot: string, relPath: string): Promise<ParsedNote | null> {
  if (!path.isAbsolute(vaultRoot)) throw new Error(`vaultRoot must be absolute`);
  if (relPath.includes("\0")) return null;
  const abs = path.resolve(vaultRoot, relPath);
  assertUnderRoot(abs, vaultRoot);
  if (!/\.md$/i.test(abs)) return null;

  let raw: string;
  let stat: { mtimeMs: number };
  try {
    [raw, stat] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);
  } catch {
    return null;
  }
  const parsed = matter(raw);
  return {
    path: path.relative(vaultRoot, abs),
    absolutePath: abs,
    frontmatter: (parsed.data as Record<string, unknown>) ?? {},
    body: parsed.content,
    mtime: stat.mtimeMs,
  };
}

/**
 * List markdown files under `<vaultRoot>/00_Inbox/agentic-os/<subdir>/`.
 * Returns relative paths sorted newest-mtime first.
 */
export async function listInboxNotes(
  vaultRoot: string,
  subdir: string,
): Promise<string[]> {
  const dir = path.join(vaultRoot, "00_Inbox", "agentic-os", subdir);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && /\.md$/i.test(e.name))
      .map((e) => path.join(dir, e.name));
    const stats = await Promise.all(files.map(async (f) => {
      try { const st = await fs.stat(f); return { f, m: st.mtimeMs }; }
      catch { return { f, m: 0 }; }
    }));
    stats.sort((a, b) => b.m - a.m);
    return stats.map(({ f }) => path.relative(vaultRoot, f));
  } catch {
    return [];                          // dir doesn't exist yet — no notes
  }
}

export async function readInboxNotes(
  vaultRoot: string,
  subdir: string,
): Promise<ParsedNote[]> {
  const rels = await listInboxNotes(vaultRoot, subdir);
  const notes = await Promise.all(rels.map((r) => readNote(vaultRoot, r)));
  return notes.filter((n): n is ParsedNote => n !== null);
}

/**
 * Walk the whole vault (skipping system dirs) and yield every .md path
 * relative to the vault root. Used by the FTS5 indexer in commit 4.
 */
export async function* walkVaultNotes(vaultRoot: string, maxDepth = 8): AsyncIterable<string> {
  if (!path.isAbsolute(vaultRoot)) throw new Error(`vaultRoot must be absolute`);
  async function* walk(dir: string, depth: number): AsyncIterable<string> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        yield* walk(full, depth + 1);
      } else if (e.isFile() && /\.md$/i.test(e.name)) {
        yield path.relative(vaultRoot, full);
      }
    }
  }
  yield* walk(vaultRoot, 0);
}
