// Single subprocess helper used by every transport. Argv arrays only, never
// shell:true, hard ceilings on arg length, null bytes rejected, and a
// strict env allowlist (parent env is NOT inherited wholesale — see
// SECURITY.md and ADR-0002). Manifests opt-in to extra env vars via the
// manifest's env: block.

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const MAX_ARG_LEN = 32_000;

// Minimal env allowlist. Things every shipped CLI plausibly needs to
// function — config paths, locale, working binary lookups — without
// forwarding the operator's exported API keys / tokens / OAuth secrets.
// Manifests add to this via their own env: block.
//
// If a CLI breaks because it needed an env var not on this list, the right
// fix is either to expand the allowlist (if the var is universally safe) or
// to declare the var explicitly in the manifest's env: block.
const ENV_ALLOWLIST = new Set<string>([
  "PATH",
  "HOME",
  "USER", "LOGNAME",
  "SHELL",
  "TERM", "COLORTERM",
  "LANG", "LC_ALL",
  "LC_CTYPE", "LC_COLLATE", "LC_MESSAGES",
  "LC_NUMERIC", "LC_TIME", "LC_MONETARY",
  "TZ",
  "TMPDIR", "TMP", "TEMP",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
  "HOSTNAME",
  "PWD",
  "NODE_PATH",
]);

/**
 * Build the env block passed to a child process. Starts from the allowlist
 * (filtered from the parent env), then overlays manifest-declared overrides,
 * then forces NO_COLOR/FORCE_COLOR so CLI output is plain text.
 *
 * Also exposes any AGENTIC_OS_* env vars unconditionally — those are our own
 * config namespace and never contain secrets.
 */
export function buildChildEnv(opts: { extra?: Record<string, string> } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (ENV_ALLOWLIST.has(k) || k.startsWith("AGENTIC_OS_")) {
      out[k] = v;
    }
  }
  // Force terminals into plain mode regardless of parent.
  out["NO_COLOR"] = "1";
  out["FORCE_COLOR"] = "0";
  // Manifest-declared additions last so they win over the allowlist.
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) out[k] = v;
  }
  return out;
}

export type SafeChild = ChildProcessByStdio<Writable, Readable, Readable>;

export interface SafeSpawnOpts {
  cwd?: string;
  env?: Record<string, string>;        // manifest-declared additions only
  signal?: AbortSignal;
}

export function safeSpawn(bin: string, args: string[], opts: SafeSpawnOpts = {}): SafeChild {
  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error("safeSpawn: bin must be a non-empty string");
  }
  for (const a of args) {
    if (typeof a !== "string") throw new Error("safeSpawn: every arg must be a string");
    if (a.length > MAX_ARG_LEN) throw new Error(`safeSpawn: arg exceeds ${MAX_ARG_LEN} chars`);
    if (a.includes("\0")) throw new Error("safeSpawn: null byte in arg");
  }

  return spawn(bin, args, {
    cwd: opts.cwd ?? process.env["HOME"],
    // Cast to NodeJS.ProcessEnv — buildChildEnv returns Record<string,string>
    // which is the runtime shape spawn() expects, but Next's strict types
    // claim certain keys are required.
    env: buildChildEnv({ extra: opts.env }) as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    signal: opts.signal,
  }) as SafeChild;
}

// Render a manifest argv template: replace exact "{prompt}" tokens with the
// real prompt. We do not interpolate inside larger strings — the placeholder
// must be an entire arg by itself, so a manifest like `args: ["-p", "{prompt}"]`
// works but `args: ["--text={prompt}"]` does NOT. This keeps the contract
// simple and avoids surprising injection-shaped behavior.
export function renderArgs(args: readonly string[], prompt: string): string[] {
  return args.map((a) => (a === "{prompt}" ? prompt : a));
}

/**
 * Like renderArgs, but substitutes a redacted placeholder for {prompt}
 * instead of the real prompt content. Use this when building the args
 * representation that lands in the audit log — never log the raw prompt.
 */
export function renderArgsForAudit(args: readonly string[]): string[] {
  return args.map((a) => (a === "{prompt}" ? "[PROMPT_REDACTED]" : a));
}

// Exposed for tests.
export const __TEST__ = { ENV_ALLOWLIST };
