// Vault writer — inbox-first contract per docs/VAULT-CONTRACT.md.
//
// Hard rules (do not bypass):
// - Writes ONLY to `<vaultRoot>/00_Inbox/agentic-os/<kind>/`.
// - Resolved path must startsWith the vault root + "/00_Inbox/agentic-os/".
//   Anything else throws.
// - Collision-safe: tries `-02`, `-03`, ... up to `-99` before failing.
// - Atomic: writes a sibling `.tmp` file, fsync best-effort, then renames.
// - Tags restricted to the operator's approved-domain list. Anything else →
//   tags: []. (Phase 1A snapshot; Phase 1B reads vault dynamically.)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { auditVaultWrite } from "../kernel/audit";
import { bus } from "../kernel/bus";

const APPROVED_TAGS = new Set([
  "ai", "crypto", "homelab", "linux", "networking", "remote-access",
  "work", "business", "health", "food", "personal", "gaming",
  "security", "automation",
]);

const KIND_TO_SUBDIR: Record<DraftKind, string> = {
  chat: "chats",
  journal: "journal",
  goal: "goals",
  summary: "summaries",
  review: "reviews",
  research: "drafts",
  "decision-draft": "drafts",
};

export type DraftKind =
  | "chat" | "journal" | "goal" | "summary" | "review" | "research" | "decision-draft";

export interface Frontmatter {
  type: DraftKind;
  status: "draft";
  source: string[];
  agent: string;
  tags: string[];
  aliases: string[];
  created: string;                      // YYYY-MM-DD
  session?: string;
  mission?: string;
}

export interface WriteDraftInput {
  vaultRoot: string;                    // absolute path
  agent: string;
  kind: DraftKind;
  title: string;
  body: string;
  tags?: string[];
  aliases?: string[];
  session?: string;
  /**
   * For `kind: "chat"` only: full prompt used to derive the filename hash.
   * Defaults to `title` if omitted. **Never appears verbatim in the
   * filename** — only its first 8 SHA-256 hex chars do. Callers should pass
   * the full prompt here so the audit log's vault.write path never leaks
   * prompt-derived characters even via the slugified title.
   * Ignored for non-chat kinds (those use operator-authored titles).
   */
  filenameSeed?: string;
}

export interface WriteDraftResult {
  path: string;                         // path relative to vault root
  absolutePath: string;
  bytes: number;
}

/**
 * Slugify a human title into a filesystem-safe segment. Keep it short — the
 * date prefix carries most of the disambiguation.
 */
export function slugify(s: string, maxLen = 40): string {
  const slug = s
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "note";
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function hhmm(): string {
  return new Date().toISOString().slice(11, 16).replace(":", "");
}

function approvedOnly(tags: string[]): string[] {
  return tags.filter((t) => APPROVED_TAGS.has(t.toLowerCase()));
}

function buildFrontmatter(fm: Frontmatter): string {
  // YAML stringify with safe quoting, then bracket as a frontmatter block.
  const doc = YAML.stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${doc}\n---\n`;
}

function buildMarkdown(input: {
  fm: Frontmatter;
  title: string;
  body: string;
}): string {
  return `${buildFrontmatter(input.fm)}\n# ${input.title}\n\n${input.body.trimEnd()}\n`;
}

function assertInsideInbox(absPath: string, vaultRoot: string): void {
  const resolved = path.resolve(absPath);
  const expectedRoot = path.resolve(path.join(vaultRoot, "00_Inbox", "agentic-os"));
  // Use path.sep-safe boundary check.
  if (resolved !== expectedRoot && !resolved.startsWith(expectedRoot + path.sep)) {
    throw new Error(
      `vault writer refused: target ${resolved} is outside ${expectedRoot}`,
    );
  }
}

/**
 * Find a non-colliding path by appending -02, -03, ... up to -99.
 * Returns the first path that doesn't already exist.
 */
async function findFreePath(baseDir: string, baseName: string, ext = ".md"): Promise<string> {
  const first = path.join(baseDir, `${baseName}${ext}`);
  try {
    await fs.access(first);
  } catch {
    return first;                       // doesn't exist — use it
  }
  for (let i = 2; i <= 99; i++) {
    const suffix = String(i).padStart(2, "0");
    const candidate = path.join(baseDir, `${baseName}-${suffix}${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`vault writer: 99 collisions for ${baseName} in ${baseDir}`);
}

/**
 * Atomic write: write to <final>.tmp.<pid>.<rand> then rename to <final>.
 * fsync is best-effort and silently skipped on platforms that don't expose it.
 */
async function atomicWrite(finalPath: string, content: string): Promise<void> {
  const dir = path.dirname(finalPath);
  const base = path.basename(finalPath);
  const tmp = path.join(dir, `.${base}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`);
  const fh = await fs.open(tmp, "wx", 0o644);
  try {
    await fh.writeFile(content, "utf8");
    try { await fh.sync(); } catch { /* fsync optional */ }
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, finalPath);
}

// `withFileLock` serializes the whole critical section per absolute path by
// chaining promises in an in-process map. Single-process scope only — that
// matches the deployment model (one local Next.js process). The map entry is
// cleared once its chain drains so it doesn't leak across many distinct
// files over a long-running session.
//
// Used by appendJournalEntry + updateFrontmatter: both do a read → build →
// atomicWrite that would lose updates under concurrent invocation (e.g. a
// fast double-tap on the journal compose button, or two goal toggles within
// the same tick). Per-path serialization fixes that without a real filesystem
// lock.
const fileLocks = new Map<string, Promise<unknown>>();

async function withFileLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(absPath);
  const prev = fileLocks.get(key) ?? Promise.resolve();
  // The next caller waits for `prev` to settle (success OR failure) before
  // running — `.catch(() => {})` makes the chain non-poisoning.
  const run = prev.catch(() => {}).then(fn);
  fileLocks.set(key, run);
  try {
    return await run;
  } finally {
    // Only clear if no newer caller has chained on after us.
    if (fileLocks.get(key) === run) fileLocks.delete(key);
  }
}

export async function writeDraft(input: WriteDraftInput): Promise<WriteDraftResult> {
  if (!path.isAbsolute(input.vaultRoot)) {
    throw new Error(`vaultRoot must be absolute: ${input.vaultRoot}`);
  }
  const subdir = KIND_TO_SUBDIR[input.kind];
  const targetDir = path.join(input.vaultRoot, "00_Inbox", "agentic-os", subdir);
  await fs.mkdir(targetDir, { recursive: true });
  assertInsideInbox(targetDir, input.vaultRoot);

  const today = todayIso();
  const time = hhmm();
  // Chat filenames are deliberately non-leaky: derive the suffix from a hash
  // of the prompt, not from a slugified prompt prefix. The H1 title and body
  // inside the markdown remain human-readable — only the filename (which
  // ends up in the vault.write audit entry's `path` field) is hashed.
  // Other kinds (goals, journal, summaries, ...) use operator-authored
  // titles that are not prompt content, so the slug stays.
  let baseName: string;
  if (input.kind === "chat") {
    const seed = input.filenameSeed ?? input.title;
    const promptSha8 = createHash("sha256").update(seed).digest("hex").slice(0, 8);
    baseName = `${today}-${time}-${input.agent}-${promptSha8}`;
  } else {
    baseName = `${today}-${slugify(input.title)}`;
  }

  const finalPath = await findFreePath(targetDir, baseName);
  assertInsideInbox(finalPath, input.vaultRoot);

  const fm: Frontmatter = {
    type: input.kind,
    status: "draft",
    source: [input.agent],
    agent: input.agent,
    tags: approvedOnly(input.tags ?? []),
    aliases: input.aliases ?? [],
    created: today,
    ...(input.session ? { session: input.session } : {}),
  };

  const content = buildMarkdown({ fm, title: input.title, body: input.body });
  await atomicWrite(finalPath, content);

  const rel = path.relative(input.vaultRoot, finalPath);
  const bytes = Buffer.byteLength(content, "utf8");

  await auditVaultWrite({ agent: input.agent, path: rel, action: "create", bytes });
  bus.emit({
    source: "vault",
    kind: "vault.write",
    payload: { agent: input.agent, path: rel, bytes },
  });

  return { path: rel, absolutePath: finalPath, bytes };
}

// ─── Journal append (one file per day, multiple timestamped sections) ────────

export interface AppendJournalInput {
  vaultRoot: string;
  agent: string;                        // usually "operator" for journal
  text: string;
  tags?: string[];
}

/**
 * Append a timestamped section to today's journal file. If today's file
 * doesn't exist yet, creates it with frontmatter + heading + the first
 * section. Atomic per operation.
 */
export async function appendJournalEntry(input: AppendJournalInput): Promise<WriteDraftResult> {
  const today = todayIso();
  const targetDir = path.join(input.vaultRoot, "00_Inbox", "agentic-os", "journal");
  await fs.mkdir(targetDir, { recursive: true });
  const finalPath = path.join(targetDir, `${today}.md`);
  assertInsideInbox(finalPath, input.vaultRoot);

  const time = new Date().toISOString().slice(11, 16);
  const entrySection = `\n### ${time}\n\n${input.text.trim()}\n`;

  // Serialize the read-modify-write so two concurrent appends to today's
  // file can't lose each other's entry. Everything that reads `finalPath`,
  // builds new content, and writes it back must be inside the lock.
  const { content, exists, bytes } = await withFileLock(finalPath, async () => {
    let exists = false;
    try { await fs.access(finalPath); exists = true; } catch { /* new file */ }

    let content: string;
    if (exists) {
      const old = await fs.readFile(finalPath, "utf8");
      content = old.replace(/\n*$/, "") + entrySection + "\n";
    } else {
      const fm: Frontmatter = {
        type: "journal",
        status: "draft",
        source: [input.agent],
        agent: input.agent,
        tags: approvedOnly(input.tags ?? []),
        aliases: [],
        created: today,
      };
      content = buildMarkdown({ fm, title: `Journal — ${today}`, body: entrySection.trimStart() });
    }

    await atomicWrite(finalPath, content);
    return { content, exists, bytes: Buffer.byteLength(content, "utf8") };
  });

  const rel = path.relative(input.vaultRoot, finalPath);

  await auditVaultWrite({
    agent: input.agent,
    path: rel,
    action: exists ? "append" : "create",
    bytes,
  });
  bus.emit({
    source: "vault",
    kind: "vault.write",
    payload: { agent: input.agent, path: rel, bytes, action: exists ? "append" : "create" },
  });

  return { path: rel, absolutePath: finalPath, bytes };
}

// ─── Frontmatter patch (used by goal status toggle) ──────────────────────────

export interface UpdateFrontmatterInput {
  vaultRoot: string;
  relPath: string;                      // must already exist under 00_Inbox/agentic-os/
  agent: string;
  patch: Record<string, unknown>;
}

/**
 * Update a note's frontmatter fields atomically. Body untouched. Only
 * permitted for notes under 00_Inbox/agentic-os/ — the inbox-first contract
 * forbids the OS modifying anything elsewhere.
 */
export async function updateFrontmatter(input: UpdateFrontmatterInput): Promise<WriteDraftResult> {
  const abs = path.resolve(input.vaultRoot, input.relPath);
  assertInsideInbox(abs, input.vaultRoot);
  if (!/\.md$/i.test(abs)) throw new Error(`not a markdown file: ${input.relPath}`);

  // Same read-modify-write race as appendJournalEntry: two concurrent
  // frontmatter patches (e.g. a fast double-tap on a goal toggle) would
  // both read the same `raw` and the second rename would drop the first
  // patch. Serialize per file path.
  const newContent = await withFileLock(abs, async () => {
    const raw = await fs.readFile(abs, "utf8");
    // Find existing frontmatter block.
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
    let body: string;
    let fm: Record<string, unknown>;
    if (fmMatch) {
      try { fm = YAML.parse(fmMatch[1] ?? "") as Record<string, unknown>; }
      catch { throw new Error(`existing frontmatter is invalid YAML in ${input.relPath}`); }
      body = raw.slice(fmMatch[0].length);
    } else {
      fm = {};
      body = raw;
    }

    const merged = { ...fm, ...input.patch };
    const content = `---\n${YAML.stringify(merged, { lineWidth: 0 }).trimEnd()}\n---\n${body}`;
    await atomicWrite(abs, content);
    return content;
  });

  const rel = path.relative(input.vaultRoot, abs);
  const bytes = Buffer.byteLength(newContent, "utf8");

  await auditVaultWrite({ agent: input.agent, path: rel, action: "append", bytes });
  bus.emit({
    source: "vault",
    kind: "vault.update",
    payload: { agent: input.agent, path: rel, bytes, patch: Object.keys(input.patch) },
  });
  return { path: rel, absolutePath: abs, bytes };
}

// Test-only export so unit tests can exercise the collision logic without a
// full vault structure.
export const __TEST__ = { assertInsideInbox, findFreePath, slugify, atomicWrite };
