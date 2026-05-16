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
  const slugBase = slugify(input.title);
  // chats get HHMM in the slug so two prompts a minute apart never collide.
  const baseName = input.kind === "chat"
    ? `${today}-${time}-${input.agent}-${slugBase}`
    : `${today}-${slugBase}`;

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

// Test-only export so unit tests can exercise the collision logic without a
// full vault structure.
export const __TEST__ = { assertInsideInbox, findFreePath, slugify, atomicWrite };
