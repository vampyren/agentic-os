// Constrained vault writer for mission outputs (Phase 1C — M4).
//
// The ONLY code path that persists a mission `vault-note` output. A
// mission RETURNS MissionOutput objects (ADR-0011); the runner hands
// the vault-note outputs here. This writer is deliberately SEPARATE
// from src/vault/writer.ts (the chat / journal / goal writer):
//   - mission outputs target a different folder allowlist
//     (summaries / reviews / missions / studio / kanban), not the
//     chat-writer's KIND_TO_SUBDIR taxonomy;
//   - mission outputs need a realpath / symlink-escape check at write
//     time, which the chat writer does not perform.
// Keeping it self-contained leaves the chat-save path untouched.
//
// Validation is fail-closed and ordered:
//   1. URL-decode any path-like input — a malformed % escape, or a NUL
//      byte, is a rejection (not a throw-through).
//   2. Lexical allowlist check (ALLOWED_MISSION_OUTPUT_ROOTS) plus
//      explicit path-separator / `..` rejection on the filename hint.
//   3. realpath / symlink-escape check AT WRITE TIME — a symlinked
//      path component resolving outside the vault inbox is refused.
//   4. Conflict policy, then an atomic tmp-file + rename write.
//
// Failures throw ConstrainedWriteError carrying only a neutral
// errorClass — never a raw path, the note content, or operator input.

import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { isAllowedMissionOutputFolder } from "@/lib/vaultPaths";

export class ConstrainedWriteError extends Error {
  readonly errorClass: string;
  constructor(errorClass: string) {
    super(errorClass);
    this.name = "ConstrainedWriteError";
    this.errorClass = errorClass;
  }
}

export interface WriteMissionNoteInput {
  /** Absolute vault root. */
  vaultRoot: string;
  missionId: string;
  /** Vault-relative output folder; allowlist-validated here. */
  outputFolder: string;
  filenameHint: string;
  frontmatter?: Record<string, unknown>;
  content: string;
  conflictPolicy?: "fail" | "overwrite" | "suffix";
}

export interface MissionWriteResult {
  /** Path relative to the (realpath-resolved) vault root. */
  relativePath: string;
  bytes: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ASCII-safe filename segment. Mission filename hints are simple. */
function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "note";
}

/** URL-decode API-influenced path input; reject malformed escapes / NUL. */
function decodeOrReject(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ConstrainedWriteError("decode-failed");
  }
  if (decoded.includes("\0")) throw new ConstrainedWriteError("decode-failed");
  return decoded;
}

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

/**
 * realpath that returns null on failure (a dangling symlink, a
 * permission error). Used for the security check: a path that cannot
 * be resolved cannot be verified, so the caller MUST reject.
 */
async function realResolve(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/**
 * Deepest ancestor of `p` (including `p` itself) that exists on disk.
 * Uses lstat, so a symlink — including a dangling one — counts as
 * "existing"; the caller realpath-checks it before any mkdir.
 */
async function deepestExisting(p: string): Promise<string> {
  let cur = path.resolve(p);
  for (;;) {
    try {
      await fs.lstat(cur);
      return cur;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** First non-colliding path, appending -02..-99. */
async function findFreePath(dir: string, baseName: string): Promise<string> {
  const first = path.join(dir, `${baseName}.md`);
  if (!(await pathExists(first))) return first;
  for (let i = 2; i <= 99; i++) {
    const candidate = path.join(dir, `${baseName}-${String(i).padStart(2, "0")}.md`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new ConstrainedWriteError("collision-exhausted");
}

/** Atomic write: sibling .tmp (O_EXCL) + fsync best-effort + rename. */
async function atomicWrite(finalPath: string, content: string): Promise<void> {
  const dir = path.dirname(finalPath);
  const base = path.basename(finalPath);
  const tmp = path.join(
    dir,
    `.${base}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`,
  );
  const fh = await fs.open(tmp, "wx", 0o644);
  try {
    await fh.writeFile(content, "utf8");
    try {
      await fh.sync();
    } catch {
      /* fsync optional */
    }
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, finalPath);
}

function buildNote(input: WriteMissionNoteInput): string {
  const fm = {
    type: "mission-output",
    mission: input.missionId,
    created: todayIso(),
    ...(input.frontmatter ?? {}),
  };
  const yaml = YAML.stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${input.content.trimEnd()}\n`;
}

/**
 * Persist a mission `vault-note` output. The only sanctioned path for
 * a mission to reach the filesystem.
 */
export async function writeMissionNote(
  input: WriteMissionNoteInput,
): Promise<MissionWriteResult> {
  if (!path.isAbsolute(input.vaultRoot)) {
    throw new ConstrainedWriteError("vault-root-invalid");
  }

  // 1. Decode path-like input.
  const folder = decodeOrReject(input.outputFolder);
  const hint = decodeOrReject(input.filenameHint);

  // 2. Lexical allowlist + filename-hint rejection.
  if (!isAllowedMissionOutputFolder(folder)) {
    throw new ConstrainedWriteError("folder-not-allowed");
  }
  if (/[\\/]/.test(hint) || hint.includes("..")) {
    throw new ConstrainedWriteError("filename-invalid");
  }

  // 3. realpath / symlink-escape check — performed BEFORE any mkdir,
  //    so a symlinked path component can never cause directories to
  //    be created outside the vault before the rejection.
  const realRoot = await realpathOrSelf(input.vaultRoot);
  const inbox = path.join(realRoot, "00_Inbox", "agentic-os");
  const targetDir = path.join(realRoot, folder);

  const inside = (p: string): boolean =>
    p === realRoot || p.startsWith(realRoot + path.sep);

  // 3a. The inbox boundary itself must resolve inside the real vault
  //     root — a symlinked 00_Inbox / agentic-os is an escape.
  const realInboxAncestor = await realResolve(await deepestExisting(inbox));
  if (realInboxAncestor === null || !inside(realInboxAncestor)) {
    throw new ConstrainedWriteError("boundary-escape");
  }

  // 3b. The deepest EXISTING ancestor of the target dir must resolve
  //     inside the vault root. Checked before mkdir so a symlinked
  //     allowed parent cannot leak nested mkdir side effects outside.
  const realTargetAncestor = await realResolve(await deepestExisting(targetDir));
  if (realTargetAncestor === null || !inside(realTargetAncestor)) {
    throw new ConstrainedWriteError("symlink-escape");
  }

  // The deepest existing ancestor is verified — creating the
  // remaining (plain, non-symlink) directories is now safe.
  await fs.mkdir(targetDir, { recursive: true });

  // 3c. Tight final containment check against the realpath-resolved
  //     inbox boundary.
  const realInbox = await realResolve(inbox);
  const realTarget = await realResolve(targetDir);
  if (
    realInbox === null ||
    realTarget === null ||
    (realTarget !== realInbox && !realTarget.startsWith(realInbox + path.sep))
  ) {
    throw new ConstrainedWriteError("symlink-escape");
  }

  // 4. Conflict policy, then atomic write.
  const baseName = `${todayIso()}-${slugify(hint)}`;
  const policy = input.conflictPolicy ?? "suffix";
  let finalPath: string;
  if (policy === "suffix") {
    finalPath = await findFreePath(realTarget, baseName);
  } else {
    finalPath = path.join(realTarget, `${baseName}.md`);
    if (policy === "fail" && (await pathExists(finalPath))) {
      throw new ConstrainedWriteError("conflict-exists");
    }
  }

  const note = buildNote(input);
  try {
    await atomicWrite(finalPath, note);
  } catch (e) {
    if (e instanceof ConstrainedWriteError) throw e;
    throw new ConstrainedWriteError("write-failed");
  }

  return {
    relativePath: path.relative(realRoot, finalPath),
    bytes: Buffer.byteLength(note, "utf8"),
  };
}
