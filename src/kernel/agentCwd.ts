// Per-agent working-directory persistence. Maps agent name to the
// absolute filesystem path that the kernel should pass as `cwd` when
// spawning the agent's transport.
//
// File: ~/.agentic-os/agent-cwd.json (overridable via AGENTIC_OS_AGENT_CWD_FILE
//       for tests / e2e isolation; same pattern as audit + vault-index).
//
// Shape: { "<agent>": "<absolute path>" }
//
// Per-agent defaults. Only agents listed in PER_AGENT_DEFAULT get a
// fallback cwd when no persisted value exists. Other agents (Hermes,
// future one-shot CLIs) get `undefined` so the transport's
// `opts.cwd ?? cfg.cwd` chain falls through to the manifest's own cwd
// (or the parent process's cwd if the manifest doesn't set one).
// This was the v0.2.12 Slice E review fix — the initial implementation
// forced ~/Documents on every agent and broke Hermes's transport
// inheritance contract.
//
// Default resolution for Claude Code: ~/Documents IF it exists and is
// a directory, otherwise $HOME. We never return a non-existent cwd —
// `spawn()` would otherwise fail with ENOENT before the agent even
// gets a chance to run.
//
// Path validation uses `fs.realpath` to resolve symlinks before the
// $HOME-or-outside decision, so a symlink under $HOME pointing
// outside $HOME (e.g. `~/link-to-tmp -> /tmp`) is correctly warned.
// Lexical inclusion alone is a classic path-authz bypass.
//
// Writes are atomic (tmp file + rename) and serialised through a
// single in-process write-chain so concurrent setAgentCwd /
// clearAgentCwd calls don't lose updates or corrupt the JSON on an
// interrupted write.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

function configPath(): string {
  return (
    process.env.AGENTIC_OS_AGENT_CWD_FILE
      ?? path.join(os.homedir(), ".agentic-os", "agent-cwd.json")
  );
}

// Resolve $HOME/Documents if it exists, otherwise $HOME itself. We
// never return a non-existent directory — passing one to spawn would
// produce an ENOENT before the agent ran. Documents is the *preferred*
// project root for code assistants; HOME is the safe fallback.
async function safeDocsCwd(): Promise<string> {
  const home = os.homedir();
  const docs = path.join(home, "Documents");
  try {
    const stat = await fs.stat(docs);
    if (stat.isDirectory()) return docs;
  } catch { /* fall through to $HOME */ }
  return home;
}

// Per-agent default registry. Each entry's `resolve` is called lazily
// so we don't fs.stat on every snapshot call until we actually need it,
// and so tests can override HOME between calls.
interface ConfiguredDefault {
  resolve: () => Promise<string>;
}
const PER_AGENT_DEFAULT: Record<string, ConfiguredDefault> = {
  "claude-code": { resolve: safeDocsCwd },
};

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === "string" && typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* missing / unreadable / unparsable — treat as empty map */
  }
  return {};
}

// Atomic write: serialise JSON to a sibling tmp file, fsync via rename
// (POSIX atomic) so a crash between writeFile and rename leaves the
// original intact. The tmp filename includes pid + ts + random nonce
// to avoid collisions when multiple processes share the same config.
async function writeMapAtomic(map: Record<string, string>): Promise<void> {
  const p = configPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(map, null, 2) + "\n", "utf8");
    await fs.rename(tmp, p);
  } catch (e) {
    // Best-effort cleanup of the tmp file on failure; ignore secondary
    // errors so the original error surfaces.
    try { await fs.unlink(tmp); } catch { /* noop */ }
    throw e;
  }
}

// In-process write serialisation. Each set/clear waits for the
// previous one to finish before reading + modifying the map. Without
// this, two concurrent calls could each read the map, modify their
// own copy, and overwrite each other — losing one of the updates.
let writeChain: Promise<unknown> = Promise.resolve();
async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  // Swallow errors on the chain itself so a failed write doesn't poison
  // subsequent operations — but propagate to THIS caller.
  writeChain = next.catch(() => undefined);
  return next;
}

export interface ValidatedCwd {
  ok: true;
  /** Validated, normalised absolute path (NOT the symlink-resolved one
   *  — we store what the operator typed so their mental model stays
   *  intact; realpath is used only for the $HOME warning decision). */
  path: string;
  /** Soft warning surfaced to the UI (e.g. path is outside $HOME after
   *  symlink resolution). */
  warning?: string;
}

export interface CwdError {
  ok: false;
  error: string;
}

export type CwdResult = ValidatedCwd | CwdError;

async function validateCwd(input: unknown): Promise<CwdResult> {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "path is required" };
  }
  if (!path.isAbsolute(input)) {
    return { ok: false, error: "path must be absolute (start with /)" };
  }
  const normalised = path.normalize(input);

  let stat;
  try {
    stat = await fs.stat(normalised);
  } catch {
    return { ok: false, error: `path does not exist: ${normalised}` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: `path is not a directory: ${normalised}` };
  }

  // Resolve symlinks before the $HOME check. A path lexically under
  // $HOME but pointing outside via symlink should still warn.
  // realpath can fail on permission errors; if it does, fall back to
  // a lexical check (no worse than the pre-fix behaviour, but the
  // happy path is now correct for symlinks).
  let realPath: string;
  let realHome: string;
  try {
    realPath = await fs.realpath(normalised);
  } catch {
    realPath = normalised;
  }
  try {
    realHome = await fs.realpath(os.homedir());
  } catch {
    realHome = os.homedir();
  }

  const insideHome = realPath === realHome || realPath.startsWith(realHome + path.sep);
  const warning = insideHome
    ? undefined
    : "path is outside $HOME — the agent will run with access to system files";

  return { ok: true, path: normalised, warning };
}

// Read the persisted cwd for an agent, but only return it if it still
// points to a directory. A stored path can go stale (operator deleted
// the folder); we silently fall back to the per-agent default rather
// than handing the kernel a path that would crash spawn().
async function readPersistedCwd(agentName: string): Promise<string | undefined> {
  const map = await readMap();
  const candidate = map[agentName];
  if (!candidate) return undefined;
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) return candidate;
  } catch { /* stale entry — fall through to default */ }
  return undefined;
}

/**
 * Effective cwd for an agent. Persisted value wins; otherwise the
 * per-agent default (if any) is applied. Returns `undefined` for
 * agents with no persisted value AND no configured default — the
 * caller (run route) should NOT pass `opts.cwd` in that case so the
 * transport's `opts.cwd ?? cfg.cwd` chain can fall through to the
 * manifest's own cwd (or the parent process's cwd).
 *
 * Slice E review fix: previously this returned $HOME/Documents
 * unconditionally, which broke Hermes (and any future agent without
 * a Claude-style default).
 */
export async function getAgentCwd(agentName: string): Promise<string | undefined> {
  const persisted = await readPersistedCwd(agentName);
  if (persisted) return persisted;
  const dflt = PER_AGENT_DEFAULT[agentName];
  if (dflt) return await dflt.resolve();
  return undefined;
}

/**
 * Snapshot of the cwd state for an agent — returned by GET
 * /api/agents/<name>/cwd. `cwd` is what the kernel would actually use
 * right now; `defaultCwd` is the per-agent default if any (null if
 * the agent has no configured default — Hermes etc.).
 */
export interface AgentCwdSnapshot {
  agent: string;
  /** Effective cwd at this moment. `null` when the agent has no
   *  persisted value and no configured default (the transport's
   *  manifest cfg.cwd / process default will be used). */
  cwd: string | null;
  /** True if `cwd` came from the persisted map. */
  persisted: boolean;
  /** The per-agent default; null if the agent has no configured default. */
  defaultCwd: string | null;
}

export async function snapshotAgentCwd(agentName: string): Promise<AgentCwdSnapshot> {
  const persisted = await readPersistedCwd(agentName);
  const dflt = PER_AGENT_DEFAULT[agentName];
  const defaultCwd = dflt ? await dflt.resolve() : null;
  const cwd = persisted ?? defaultCwd;
  return {
    agent: agentName,
    cwd,
    persisted: Boolean(persisted),
    defaultCwd,
  };
}

/**
 * Persist a cwd for an agent. Validates first; never partially-writes
 * the JSON file. Serialised against concurrent set/clear calls.
 */
export async function setAgentCwd(agentName: string, cwd: unknown): Promise<CwdResult> {
  if (!agentName || typeof agentName !== "string") {
    return { ok: false, error: "agent name is required" };
  }
  const v = await validateCwd(cwd);
  if (!v.ok) return v;
  return withWriteLock(async () => {
    const map = await readMap();
    map[agentName] = v.path;
    await writeMapAtomic(map);
    return v;
  });
}

/**
 * Remove the persisted cwd for an agent — the next spawn falls back
 * to the per-agent default (Claude) or `undefined` (other agents).
 */
export async function clearAgentCwd(agentName: string): Promise<void> {
  await withWriteLock(async () => {
    const map = await readMap();
    if (!(agentName in map)) return;
    delete map[agentName];
    await writeMapAtomic(map);
  });
}
