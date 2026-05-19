// Per-agent working-directory persistence. Maps agent name to the
// absolute filesystem path that the kernel should pass as `cwd` when
// spawning the agent's transport (typically the directory the operator
// wants the CLI to operate on — e.g. a Claude Code project root).
//
// File: ~/.agentic-os/agent-cwd.json (overridable via AGENTIC_OS_AGENT_CWD_FILE
//       for tests / e2e isolation; same pattern as the audit log and the
//       vault index).
//
// Shape: { "<agent>": "<absolute path>" }
//
// Default when no entry exists OR when the stored path is no longer
// valid (e.g. directory deleted): $HOME/Documents. We pick a sensible
// project root so the operator gets a reasonable default for code
// assistants like Claude Code; we do not silently fall back to wherever
// the Next.js server runs from (which would be the repo itself —
// surprising and rarely what's wanted).
//
// Fail-soft contract: any I/O error from reading/writing the JSON file
// is silently coerced to "no persisted value" and the default kicks
// in. The kernel never throws because the cwd file is unreadable.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

function configPath(): string {
  return (
    process.env.AGENTIC_OS_AGENT_CWD_FILE
      ?? path.join(os.homedir(), ".agentic-os", "agent-cwd.json")
  );
}

function defaultCwd(): string {
  return path.join(os.homedir(), "Documents");
}

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

async function writeMap(map: Record<string, string>): Promise<void> {
  const p = configPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(map, null, 2) + "\n", "utf8");
}

export interface ValidatedCwd {
  ok: true;
  /** Validated, normalised absolute path. */
  path: string;
  /** Soft warning surfaced to the UI (e.g. path is outside $HOME). */
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
  // Normalise (resolves any trailing slashes, '..' segments, etc.) and
  // re-check after normalisation so a sneaky '/foo/../bar' is validated
  // as '/bar'. We don't reject '..' outright because '/home/spawn/Apps/..'
  // is a legitimate way for the operator to express '/home/spawn'.
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

  const home = os.homedir();
  const insideHome = normalised === home || normalised.startsWith(home + path.sep);
  const warning = insideHome
    ? undefined
    : "path is outside $HOME — the agent will run with access to system files";

  return { ok: true, path: normalised, warning };
}

/**
 * Returns the effective cwd for an agent. Uses the persisted value if
 * it points to an existing directory; otherwise falls back to
 * $HOME/Documents. Never throws — a missing/broken JSON file silently
 * resolves to the default.
 */
export async function getAgentCwd(agentName: string): Promise<string> {
  const map = await readMap();
  const candidate = map[agentName];
  if (candidate) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      /* stored path no longer valid — fall through to default */
    }
  }
  return defaultCwd();
}

/**
 * Snapshot of the cwd state for an agent — what we return from the
 * GET /api/agents/<name>/cwd route.
 */
export interface AgentCwdSnapshot {
  agent: string;
  /** Effective cwd (the value the kernel would actually use right now). */
  cwd: string;
  /** True if `cwd` came from the persisted map; false if it's the default. */
  persisted: boolean;
  /** The default fallback ($HOME/Documents). Useful for the UI to show a Reset hint. */
  defaultCwd: string;
}

export async function snapshotAgentCwd(agentName: string): Promise<AgentCwdSnapshot> {
  const map = await readMap();
  const stored = map[agentName];
  let persisted = false;
  let cwd = defaultCwd();
  if (stored) {
    try {
      const stat = await fs.stat(stored);
      if (stat.isDirectory()) {
        cwd = stored;
        persisted = true;
      }
    } catch {
      /* stored path no longer valid — report default but flag not persisted */
    }
  }
  return { agent: agentName, cwd, persisted, defaultCwd: defaultCwd() };
}

/**
 * Persist a cwd for an agent. Validates first. Returns the validated
 * path (with any soft warning) or a structured error.
 */
export async function setAgentCwd(agentName: string, cwd: unknown): Promise<CwdResult> {
  if (!agentName || typeof agentName !== "string") {
    return { ok: false, error: "agent name is required" };
  }
  const v = await validateCwd(cwd);
  if (!v.ok) return v;
  const map = await readMap();
  map[agentName] = v.path;
  await writeMap(map);
  return v;
}

/**
 * Remove the persisted cwd for an agent. Used by the UI's "Reset to
 * default" button (the next spawn will fall back to $HOME/Documents).
 */
export async function clearAgentCwd(agentName: string): Promise<void> {
  const map = await readMap();
  if (!(agentName in map)) return;
  delete map[agentName];
  await writeMap(map);
}
