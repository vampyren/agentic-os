// streamJson transport: spawn Claude Code with --output-format=stream-json
// --include-partial-messages, parse NDJSON line by line, yield typed token
// events as deltas arrive. Falls back to a single token from the final
// `assistant` or `result` event if no incremental deltas were emitted.
// Also extracts usage stats (model, token counts, cost) from result/assistant
// events and emits them as `usage` events.
//
// stderr contract: `claude -p` writes NON-fatal text to stderr (MCP server
// logs, deprecation notices, telemetry hints). stderr is therefore BUFFERED,
// not eagerly turned into `error` events — an `error` is emitted only if the
// process exits non-zero, mirroring the subprocess transport. Treating every
// stderr chunk as fatal previously surfaced a spurious error in the chat UI
// (and a spurious audit `agent.invoke.error` line) on fully successful runs.

import { safeSpawn, renderArgs } from "../spawn";
import type {
  AgentEvent,
  AgentManifest,
  AgentUsage,
  HealthReport,
  StreamJsonTransportConfig,
  StreamOpts,
  Transport,
} from "../types";

// Overall wall-clock cap for a streaming invocation when the manifest does
// not set transportConfig.timeoutMs. Matches the subprocess transport's
// default so a wedged `claude` process can't hang forever.
const DEFAULT_TIMEOUT = 120_000;

// Ceiling on un-newlined stdout held in `buf`. NDJSON lines are normally
// well under a kilobyte; anything past this is a pathological/garbage line,
// so we abort rather than let the buffer grow without bound.
const MAX_BUFFER_BYTES = 1024 * 1024;     // 1 MiB

// Ceiling on accumulated fallback text (used only when no streaming deltas
// arrived). Bounds memory if a `result` event carries a huge body.
const MAX_FALLBACK_CHARS = 1024 * 1024;   // ~1 MiB of chars

// Ceiling on the buffered stderr we hold for the error message. Avoids
// unbounded growth if the child floods stderr.
const MAX_STDERR_BYTES = 64 * 1024;       // 64 KiB is enough for error context

/**
 * Pull usage stats out of a Claude Code stream-json event. Returns undefined
 * if nothing useful is present. Multiple events may carry usage during a
 * single call; we emit each and the UI keeps the most-recent.
 *
 * Exported for unit testing.
 */
export function extractUsage(e: Record<string, unknown>): AgentUsage | undefined {
  const out: AgentUsage = {};
  let any = false;

  const model = e["model"];
  if (typeof model === "string") { out.model = model; any = true; }

  const cost = e["total_cost_usd"];
  if (typeof cost === "number") { out.totalCostUsd = cost; any = true; }

  // Find usage either at top level (result event) or inside message (assistant
  // event).
  const candidates: unknown[] = [
    e["usage"],
    (e["message"] as Record<string, unknown> | undefined)?.["usage"],
  ];
  for (const u of candidates) {
    if (typeof u !== "object" || u === null) continue;
    const r = u as Record<string, unknown>;
    if (typeof r["input_tokens"] === "number") { out.inputTokens = r["input_tokens"] as number; any = true; }
    if (typeof r["output_tokens"] === "number") { out.outputTokens = r["output_tokens"] as number; any = true; }
    if (typeof r["cache_read_input_tokens"] === "number") { out.cacheReadInputTokens = r["cache_read_input_tokens"] as number; any = true; }
    if (typeof r["cache_creation_input_tokens"] === "number") { out.cacheCreationInputTokens = r["cache_creation_input_tokens"] as number; any = true; }
  }

  return any ? out : undefined;
}

export function createStreamJsonTransport(manifest: AgentManifest): Transport {
  if (manifest.transport !== "streamJson") {
    throw new Error(`streamJson transport given non-streamJson manifest: ${manifest.name}`);
  }
  const cfg = manifest.transportConfig as StreamJsonTransportConfig;

  return {
    async health(): Promise<HealthReport> {
      const probe = manifest.healthProbe;
      const command = probe?.command ?? [cfg.bin, "--version"];
      const [bin, ...args] = command;
      if (!bin) {
        return { status: "unknown", message: "no health probe command", checkedAt: Date.now() };
      }
      const timeoutMs = probe?.timeoutMs ?? 3000;

      return await new Promise((resolve) => {
        let child;
        try {
          child = safeSpawn(bin, args);
        } catch (e) {
          resolve({ status: "offline", message: String(e).slice(0, 200), checkedAt: Date.now() });
          return;
        }
        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }, timeoutMs);
        child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
        child.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });
        try { child.stdin?.end(); } catch { /* ignore */ }
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve({
              status: "live",
              version: stdout.trim().split("\n")[0]?.slice(0, 120),
              checkedAt: Date.now(),
            });
          } else {
            resolve({
              status: "degraded",
              message: stderr.slice(0, 200) || `exit ${code}`,
              checkedAt: Date.now(),
            });
          }
        });
        child.on("error", (e) => {
          clearTimeout(timeout);
          resolve({ status: "offline", message: String(e).slice(0, 200), checkedAt: Date.now() });
        });
      });
    },

    async *stream(opts: StreamOpts): AsyncIterable<AgentEvent> {
      const startedAt = Date.now();
      const args = renderArgs(cfg.args, opts.prompt);
      const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;

      let child;
      try {
        child = safeSpawn(cfg.bin, args, { cwd: opts.cwd ?? cfg.cwd, signal: opts.signal });
      } catch (e) {
        yield { kind: "error", message: String(e) };
        yield { kind: "done", durationMs: Date.now() - startedAt, exitCode: -1 };
        return;
      }

      // We need to interleave stdout lines and the exit event in a single
      // async iterator. Use a small queue + a resolver.
      const queue: AgentEvent[] = [];
      let resolveNext: (() => void) | null = null;
      let closed = false;
      let exitCode: number | null = null;
      let sawDelta = false;
      let fallbackText = "";
      let buf = "";
      // stderr is buffered, not eagerly emitted — see the stderr contract
      // note at the top of this file. Surfaced as an `error` event only on
      // a non-zero exit.
      let stderrBuf = "";
      let killedForTimeout = false;
      let killedForBuffer = false;

      const push = (e: AgentEvent) => {
        queue.push(e);
        resolveNext?.();
      };

      // Overall wall-clock guard. Cleared in the close / error handlers below.
      const timeout = setTimeout(() => {
        killedForTimeout = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, timeoutMs);

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: unknown;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          return;                       // non-JSON lines (rare) ignored
        }
        if (typeof evt !== "object" || evt === null) return;
        const e = evt as Record<string, unknown>;

        // Incremental token deltas — preferred path.
        if (e["type"] === "stream_event") {
          const event = e["event"] as Record<string, unknown> | undefined;
          const delta = event?.["delta"] as Record<string, unknown> | undefined;
          const text = delta?.["text"];
          if (typeof text === "string" && text.length > 0) {
            sawDelta = true;
            push({ kind: "token", text });
          }
          return;
        }

        // Full assistant message — extract both the body text (used as
        // fallback if we never got streaming deltas) AND the per-message
        // usage that Claude includes on most assistant turns.
        if (e["type"] === "assistant") {
          const message = e["message"] as Record<string, unknown> | undefined;
          const content = message?.["content"];
          if (Array.isArray(content)) {
            for (const part of content) {
              if (
                typeof part === "object" && part !== null &&
                (part as Record<string, unknown>)["type"] === "text"
              ) {
                const text = (part as Record<string, unknown>)["text"];
                if (typeof text === "string" && fallbackText.length < MAX_FALLBACK_CHARS) {
                  // Hard-cap: a single huge `text` mustn't blow past the
                  // ceiling. Clamp to remaining capacity, not just the
                  // pre-append length.
                  const remaining = MAX_FALLBACK_CHARS - fallbackText.length;
                  fallbackText += text.slice(0, remaining);
                }
              }
            }
          }
          const usage = extractUsage(e);
          if (usage) push({ kind: "usage", usage });
          return;
        }

        // Final result event. Carries cumulative usage + cost.
        if (e["type"] === "result") {
          const r = e["result"];
          if (typeof r === "string" && r.length > 0) {
            if (!fallbackText) fallbackText = r.slice(0, MAX_FALLBACK_CHARS);
          }
          const usage = extractUsage(e);
          if (usage) push({ kind: "usage", usage });
          return;
        }

        // System init carries the model name — emit so the UI gets it
        // before any tokens stream in.
        if (e["type"] === "system" && e["subtype"] === "init") {
          const model = typeof e["model"] === "string" ? e["model"] : undefined;
          if (model) push({ kind: "usage", usage: { model } });
          return;
        }
      };

      child.stdout?.on("data", (b: Buffer) => {
        buf += b.toString("utf8");
        let nl: number;
        // eslint-disable-next-line no-cond-assign
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          handleLine(line);
        }
        // A single un-newlined line past the ceiling is pathological —
        // abort rather than buffer without bound.
        if (buf.length > MAX_BUFFER_BYTES) {
          killedForBuffer = true;
          buf = "";
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }
      });

      child.stderr?.on("data", (b: Buffer) => {
        // Buffer stderr; do NOT emit an error per chunk. `claude -p` writes
        // non-fatal text here. We surface it (and only it) on non-zero exit.
        if (stderrBuf.length < MAX_STDERR_BYTES) {
          stderrBuf += b.toString("utf8");
        }
      });

      try { child.stdin?.end(); } catch { /* ignore */ }

      child.on("close", (code) => {
        clearTimeout(timeout);
        // Flush any final buffered line.
        if (buf.trim()) handleLine(buf);
        buf = "";
        if (!sawDelta && fallbackText) {
          push({ kind: "token", text: fallbackText });
        }
        exitCode = code;
        // Emit error events only for genuine failures — never for a clean
        // run that merely wrote informational text to stderr.
        if (killedForTimeout) {
          push({ kind: "error", message: `timeout after ${timeoutMs}ms` });
        } else if (killedForBuffer) {
          push({ kind: "error", message: `stdout exceeded ${MAX_BUFFER_BYTES} byte buffer cap` });
        } else if (code !== 0 && code !== null) {
          push({
            kind: "error",
            message: stderrBuf.trim().slice(0, 500) || `exit ${code}`,
          });
        } else if (code === null) {
          // Child was terminated by an external signal (SIGTERM/SIGKILL from
          // outside our own timeout/buffer paths — e.g. an OS oom-kill, an
          // operator running `kill` against the pid, or our AbortController
          // signal firing when the operator hits Stop / navigates away). Not
          // a clean run; surface as an error so it doesn't look like a
          // successful chat that just produced no output.
          push({
            kind: "error",
            message: stderrBuf.trim().slice(0, 500) || "terminated by signal",
          });
        }
        closed = true;
        resolveNext?.();
      });
      child.on("error", (e) => {
        clearTimeout(timeout);
        push({ kind: "error", message: String(e) });
        closed = true;
        resolveNext?.();
      });

      while (true) {
        if (queue.length === 0) {
          if (closed) break;
          await new Promise<void>((resolve) => { resolveNext = resolve; });
          resolveNext = null;
        }
        const evt = queue.shift();
        if (evt) yield evt;
      }

      yield { kind: "done", durationMs: Date.now() - startedAt, exitCode };
    },
  };
}
