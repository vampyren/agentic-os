// Vault search index. SQLite FTS5 over note title + body + path. Mirrors the
// markdown source of truth — see ADR-0004. Markdown stays canonical; this DB
// is derived state that can be deleted and rebuilt at any time.
//
// On boot: open/create db, schema migrate, run a full scan to catch up with
// vault changes since last run. Then start a chokidar watcher that keeps the
// index in sync incrementally as the operator edits notes.

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import Database from "better-sqlite3";
import chokidar, { type FSWatcher } from "chokidar";
import { walkVaultNotes, readNote } from "@/vault/reader";

const SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS notes_meta (
  path TEXT PRIMARY KEY,
  title TEXT,
  type TEXT,
  agent TEXT,
  tags TEXT,
  created TEXT,
  mtime REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_meta_mtime ON notes_meta(mtime DESC);
`;

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  type: string | null;
  agent: string | null;
  mtime: number;
  score: number;                        // bm25 (lower = better; we invert for display)
}

interface IndexerOpts {
  dbPath: string;
  vaultRoot: string;
}

export class VaultIndex {
  private db: Database.Database;
  private watcher: FSWatcher | null = null;
  private vaultRoot: string;
  private fullScanPromise: Promise<{ indexed: number; skipped: number }> | null = null;

  constructor(opts: IndexerOpts) {
    if (!path.isAbsolute(opts.vaultRoot)) {
      throw new Error("vaultRoot must be absolute");
    }
    this.vaultRoot = opts.vaultRoot;
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    try { this.watcher?.close(); } catch { /* ignore */ }
    this.watcher = null;
    try { this.db.close(); } catch { /* ignore */ }
  }

  /**
   * Walk the vault and upsert every note. Idempotent — skips files whose
   * mtime matches what's already indexed.
   */
  async fullScan(): Promise<{ indexed: number; skipped: number }> {
    if (this.fullScanPromise) return this.fullScanPromise;
    this.fullScanPromise = (async () => {
      let indexed = 0;
      let skipped = 0;
      const seen = new Set<string>();
      const getMtime = this.db.prepare<[string], { mtime: number }>("SELECT mtime FROM notes_meta WHERE path = ?");
      for await (const rel of walkVaultNotes(this.vaultRoot)) {
        seen.add(rel);
        const note = await readNote(this.vaultRoot, rel);
        if (!note) { skipped++; continue; }
        const cached = getMtime.get(rel);
        if (cached && cached.mtime >= note.mtime - 1) {
          skipped++;
          continue;
        }
        this.upsert(note);
        indexed++;
      }
      // Drop rows for files that no longer exist.
      const allPaths = this.db.prepare<[], { path: string }>("SELECT path FROM notes_meta").all();
      for (const row of allPaths) {
        if (!seen.has(row.path)) this.remove(row.path);
      }
      return { indexed, skipped };
    })();
    return this.fullScanPromise;
  }

  startWatcher(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.vaultRoot, {
      ignoreInitial: true,
      ignored: [
        /(^|[/\\])\.obsidian([/\\]|$)/,
        /(^|[/\\])\.git([/\\]|$)/,
        /(^|[/\\])\.trash([/\\]|$)/,
        /(^|[/\\])node_modules([/\\]|$)/,
        /(^|[/\\])60_Attachments([/\\]|$)/,
      ],
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    const reindex = async (absPath: string) => {
      if (!/\.md$/i.test(absPath)) return;
      const rel = path.relative(this.vaultRoot, absPath);
      const note = await readNote(this.vaultRoot, rel);
      if (note) this.upsert(note);
    };
    this.watcher.on("add", reindex);
    this.watcher.on("change", reindex);
    this.watcher.on("unlink", (absPath: string) => {
      if (!/\.md$/i.test(absPath)) return;
      const rel = path.relative(this.vaultRoot, absPath);
      this.remove(rel);
    });
  }

  private upsert(note: { path: string; frontmatter: Record<string, unknown>; body: string; mtime: number }): void {
    const titleMatch = note.body.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? note.path.split("/").pop()?.replace(/\.md$/, "") ?? note.path;
    // Coerce every bind value to string | null. Frontmatter is YAML; gray-
    // matter parses with type inference — dates become Date objects, numbers
    // become numbers, etc. SQLite's binder only accepts primitives, so we
    // normalize here.
    const type = stringOrNull(note.frontmatter["type"]);
    const agent = stringOrNull(note.frontmatter["agent"]);
    const created = stringOrNull(note.frontmatter["created"]);
    const tagsRaw = note.frontmatter["tags"];
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw.map((t) => (typeof t === "string" ? t : String(t))).join(" ")
      : "";

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM notes_fts WHERE path = ?").run(note.path);
      this.db.prepare(
        "INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)",
      ).run(note.path, title, note.body);

      this.db.prepare(`
        INSERT INTO notes_meta (path, title, type, agent, tags, created, mtime)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          title=excluded.title, type=excluded.type, agent=excluded.agent,
          tags=excluded.tags, created=excluded.created, mtime=excluded.mtime
      `).run(note.path, title, type, agent, tags, created, note.mtime);
    });
    tx();
  }

  private remove(relPath: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM notes_fts WHERE path = ?").run(relPath);
      this.db.prepare("DELETE FROM notes_meta WHERE path = ?").run(relPath);
    });
    tx();
  }

  search(query: string, limit = 30): SearchHit[] {
    if (!query.trim()) return [];
    // bm25() returns a non-negative score; lower = more relevant.
    // snippet(table, col, before, after, ellipsis, tokens)
    const stmt = this.db.prepare<[string, number], {
      path: string; title: string; snippet: string;
      score: number; type: string | null; agent: string | null; mtime: number;
    }>(`
      SELECT
        fts.path AS path,
        fts.title AS title,
        snippet(notes_fts, 2, '«', '»', '…', 12) AS snippet,
        bm25(notes_fts) AS score,
        meta.type AS type,
        meta.agent AS agent,
        meta.mtime AS mtime
      FROM notes_fts AS fts
      JOIN notes_meta AS meta ON meta.path = fts.path
      WHERE notes_fts MATCH ?
      ORDER BY bm25(notes_fts)
      LIMIT ?
    `);
    try {
      return stmt.all(escapeFtsQuery(query), limit);
    } catch {
      // FTS5 throws on syntax errors in user input (e.g., a bare ":").
      // Strip operators and try again as a plain phrase.
      const safe = query.replace(/[^A-Za-z0-9À-￿\s]/g, " ").trim();
      if (!safe) return [];
      return stmt.all(`"${safe}"`, limit);
    }
  }

  count(): number {
    const row = this.db.prepare<[], { c: number }>("SELECT COUNT(*) AS c FROM notes_meta").get();
    return row?.c ?? 0;
  }
}

/**
 * Coerce a frontmatter value to a string (or null). Handles Date objects
 * (gray-matter parses YAML dates), numbers, and other primitives.
 */
function stringOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/**
 * FTS5's query syntax is permissive but punctuation can produce syntax errors.
 * For the dashboard search box we want phrase-ish search; wrap the input as a
 * phrase if it contains anything sketchy. Caller can pass FTS operators
 * directly if they want (we only fall back on error).
 */
function escapeFtsQuery(q: string): string {
  // If the query already has FTS operators (AND, OR, NEAR, *), pass through.
  if (/\b(AND|OR|NEAR|NOT)\b|[*"]/.test(q)) return q;
  // Otherwise treat as a quoted phrase to suppress operator interpretation.
  const cleaned = q.replace(/"/g, "");
  return `"${cleaned}"`;
}

// ────────────────────────────────────────────────────────────────────────
// Singleton

interface GlobalIndexState {
  index: VaultIndex | null;
  initPromise: Promise<void> | null;
}

const G = globalThis as unknown as { __agenticVaultIndex?: GlobalIndexState };
const state: GlobalIndexState =
  G.__agenticVaultIndex ?? (G.__agenticVaultIndex = { index: null, initPromise: null });

export interface GetIndexOpts {
  vaultRoot: string;
  dbPath?: string;                      // default ~/.agentic-os/index.db
}

export async function getVaultIndex(opts: GetIndexOpts): Promise<VaultIndex> {
  if (state.index) return state.index;
  if (!state.initPromise) {
    state.initPromise = (async () => {
      const dbPath = opts.dbPath ?? path.join(os.homedir(), ".agentic-os", "index.db");
      await fs.mkdir(path.dirname(dbPath), { recursive: true });
      const idx = new VaultIndex({ dbPath, vaultRoot: opts.vaultRoot });
      state.index = idx;
      // Initial scan (await it so the first search query sees real data) then
      // start the watcher in the background.
      await idx.fullScan();
      idx.startWatcher();
    })();
  }
  await state.initPromise;
  if (!state.index) throw new Error("vault index init failed");
  return state.index;
}
