// Single subprocess helper used by every transport. Argv arrays only, never
// shell:true, hard ceilings on arg length and rejection of null bytes.
// SECURITY.md mandates this; do not bypass.

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const MAX_ARG_LEN = 32_000;

export type SafeChild = ChildProcessByStdio<Writable, Readable, Readable>;

export interface SafeSpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
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
    cwd: opts.cwd ?? process.env.HOME,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...(opts.env ?? {}),
    },
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
