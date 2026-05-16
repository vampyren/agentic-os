// Subprocess transport: spawn a CLI, render {prompt} into argv, capture
// stdout, yield one token event with the full text once the child exits.
// Used by Hermes (`hermes -z {prompt}`) and any other one-shot CLI agent.

import { safeSpawn, renderArgs } from "../spawn";
import type {
  AgentEvent,
  HealthReport,
  StreamOpts,
  SubprocessTransportConfig,
  Transport,
  AgentManifest,
} from "../types";

const DEFAULT_TIMEOUT = 120_000;

export function createSubprocessTransport(manifest: AgentManifest): Transport {
  if (manifest.transport !== "subprocess") {
    throw new Error(`subprocess transport given non-subprocess manifest: ${manifest.name}`);
  }
  const cfg = manifest.transportConfig as SubprocessTransportConfig;

  return {
    async health(): Promise<HealthReport> {
      const probe = manifest.healthProbe;
      const command = probe?.command ?? [cfg.bin, "--version"];
      const [bin, ...args] = command;
      if (!bin) {
        return { status: "unknown", message: "no health probe command", checkedAt: Date.now() };
      }
      const timeoutMs = probe?.timeoutMs ?? 3000;
      try {
        const out = await runOneShot(bin, args, { timeoutMs });
        if (out.exitCode === 0) {
          return {
            status: "live",
            version: out.stdout.trim().split("\n")[0]?.slice(0, 120),
            checkedAt: Date.now(),
          };
        }
        return {
          status: "degraded",
          message: out.stderr.slice(0, 200) || `exit ${out.exitCode}`,
          checkedAt: Date.now(),
        };
      } catch (e) {
        return { status: "offline", message: String(e).slice(0, 200), checkedAt: Date.now() };
      }
    },

    async *stream(opts: StreamOpts): AsyncIterable<AgentEvent> {
      const startedAt = Date.now();
      const args = renderArgs(cfg.args, opts.prompt);
      const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;

      let child;
      try {
        child = safeSpawn(cfg.bin, args, {
          cwd: opts.cwd ?? cfg.cwd,
          env: cfg.env,
          signal: opts.signal,
        });
      } catch (e) {
        yield { kind: "error", message: String(e) };
        yield { kind: "done", durationMs: Date.now() - startedAt, exitCode: -1 };
        return;
      }

      // We have to consume the child's exit and stdout together. Easiest is
      // to collect them via promise and yield once.
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let killedForTimeout = false;
      const timeout = setTimeout(() => {
        killedForTimeout = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, timeoutMs);

      child.stdout?.on("data", (b: Buffer) => stdoutChunks.push(b));
      child.stderr?.on("data", (b: Buffer) => stderrChunks.push(b));
      try { child.stdin?.end(); } catch { /* ignore */ }

      const exitCode: number | null = await new Promise((resolve) => {
        child.on("close", (code) => resolve(code));
        child.on("error", () => resolve(-1));
      });
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      // Strip any ANSI escapes a CLI may still emit despite NO_COLOR.
      const cleaned = stdout.replace(/\x1b\[[0-9;]*m/g, "").trim();

      if (killedForTimeout) {
        yield { kind: "error", message: `timeout after ${timeoutMs}ms` };
      } else if (exitCode !== 0) {
        yield {
          kind: "error",
          message: stderr.slice(0, 500) || `exit ${exitCode}`,
        };
      } else if (cleaned.length > 0) {
        yield { kind: "token", text: cleaned };
      } else {
        yield { kind: "token", text: "(no output)" };
      }
      yield { kind: "done", durationMs: Date.now() - startedAt, exitCode };
    },
  };
}

// Small helper for the health probe — collects stdout, exit code, with timeout.
// Throws on spawn errors (ENOENT, EACCES, etc.) so the caller can distinguish
// "binary not installed" (offline) from "ran but unhealthy" (degraded).
async function runOneShot(
  bin: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = safeSpawn(bin, args);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const timeout = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }, opts.timeoutMs);
  child.stdout?.on("data", (b: Buffer) => out.push(b));
  child.stderr?.on("data", (b: Buffer) => err.push(b));
  try { child.stdin?.end(); } catch { /* ignore */ }
  const exitCode: number | null = await new Promise((resolve, reject) => {
    child.on("close", (c) => resolve(c));
    child.on("error", (e) => reject(e));
  });
  clearTimeout(timeout);
  return {
    exitCode,
    stdout: Buffer.concat(out).toString("utf8"),
    stderr: Buffer.concat(err).toString("utf8"),
  };
}
