// GET /api/agents/[name]/actions/[action] — run a manifest-declared read-only
// action (e.g. Hermes Status / Sessions / Insights row in the Control Room).
//
// SECURITY contract:
// - Spawn via safeSpawn — no shell:true, env allowlist, argv ceiling.
// - Per-action timeout from the manifest's `timeoutMs`: default 5s, clamped
//   at 60s max (raised from 10s during v0.2.11 so slower read-only verbs
//   like `hermes insights` can finish without being killed).
// - stdout/stderr captured with a hard 256 KiB byte cap per stream so a
//   chatty CLI can't fill memory. Captured text is cleaned server-side
//   (stripAnsi + CR normalisation + per-line clamp at 1000 chars) before
//   reaching the localhost UI. Cleaned output is returned to the operator's
//   browser but NEVER written to the JSONL audit log (per ADR-0009): action
//   output is operator-private content (prompt previews, model output).
// - Fail-soft: any error returns 200 with `{ok: false, errorClass}`. The
//   main chat path on the same agent is NEVER affected by an action result.

import path from "node:path";
import { registry } from "@/kernel/registry";
import { safeSpawn } from "@/kernel/spawn";
import { auditAgentAction, classifyAgentError } from "@/kernel/audit";
import { bus } from "@/kernel/bus";
import { stripAnsi, clampLines } from "@/kernel/textSanitize";
import { originOk, forbidden } from "../../../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard caps. The audit log captures lengths but not content; these protect
// the Node process from a runaway child.
const MAX_OUTPUT_BYTES = 256 * 1024;     // 256 KiB cap per stream
// Raised from the original 10s ceiling to 60s: `hermes insights` and
// similar analytics commands can take 20–40s on a busy session. The
// default stays at 5s for fast verbs; manifests opt up via `timeoutMs:`
// per action. Above 60s the run is still killed to protect the Node
// event loop.
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
// Per-line clamp applied to stdout/stderr before sending to the UI.
// Generous (typical table rows are ≤ 120 chars), but caps pathological
// rows like a `hermes sessions list` Preview cell that dumps a
// multi-kilobyte system prompt.
const MAX_LINE_CHARS = 1000;

interface ActionResult {
  ok: boolean;
  actionId: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  errorClass?: string;
  errorMessage?: string;                  // operator-facing, neutral
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string; action: string }> },
) {
  if (!originOk(req)) return forbidden();
  await registry.init();
  const { name, action } = await ctx.params;

  const reg = registry.get(name);
  if (!reg) {
    return Response.json(
      { ok: false, errorClass: "unknown-agent", errorMessage: `unknown agent: ${name}` },
      { status: 404 },
    );
  }

  const def = (reg.manifest.actions ?? []).find((a) => a.id === action);
  if (!def) {
    return Response.json(
      { ok: false, errorClass: "unknown-action", errorMessage: `unknown action: ${action}` },
      { status: 404 },
    );
  }

  // Defensive: manifest validation already enforces non-empty argv, but
  // re-assert at runtime — a 0-length command would crash safeSpawn.
  const [bin, ...args] = def.command;
  if (!bin) {
    return Response.json(
      { ok: false, errorClass: "manifest-error", errorMessage: "action command is empty" },
      { status: 500 },
    );
  }

  const timeoutMs = Math.min(def.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  bus.emit({
    source: name,
    kind: "agent.action.invoke",
    payload: { actionId: action },
  });

  const result = await runActionCapture({
    bin,
    args,
    timeoutMs,
    signal: req.signal,
    cwd: path.resolve(process.env["HOME"] ?? "/tmp"),
  });

  // Strip ANSI escapes + clamp pathological-length lines BEFORE we hand
  // the text to the UI. Server-side so the UI viewer is dumb, and so
  // the byte counts we report reflect what the operator actually sees.
  // SECURITY: the JSONL audit log still records only lengths + neutral
  // classification — raw text never leaves this function.
  const cleanStdout = clampLines(stripAnsi(result.stdout), MAX_LINE_CHARS);
  const cleanStderr = clampLines(stripAnsi(result.stderr), MAX_LINE_CHARS);

  const finalResult: ActionResult = {
    ok: result.exitCode === 0,
    actionId: action,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: cleanStdout,
    stderr: cleanStderr,
    truncated: result.truncated,
  };

  if (!finalResult.ok) {
    // Classify off the RAW stderr (pre-strip) so we don't misclassify
    // an error containing keywords like "timeout" that were actually
    // wrapped in ANSI codes.
    finalResult.errorClass = classifyAgentError({
      message: result.stderr || result.spawnError || "",
      exitCode: result.exitCode,
    });
    // Neutral operator-facing message. Stderr content stays in the
    // response body (localhost-only UI) but is never copied here, to
    // avoid surfacing prompt-shaped text in a status line.
    finalResult.errorMessage = neutralErrorMessage(finalResult.errorClass, result.exitCode);
  }

  bus.emit({
    source: name,
    kind: finalResult.ok ? "agent.action.complete" : "agent.action.error",
    payload: {
      actionId: action,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      // Cleaned-text lengths — match what the operator actually saw in
      // the viewer, and align with what the audit envelope records.
      stdoutChars: cleanStdout.length,
      stderrChars: cleanStderr.length,
      ...(finalResult.errorClass ? { errorClass: finalResult.errorClass } : {}),
    },
  });

  // Audit log: neutral envelope only. Output never written here.
  await auditAgentAction({
    agent: name,
    actionId: action,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutChars: cleanStdout.length,
    stderrChars: cleanStderr.length,
    errorClass: finalResult.errorClass as ReturnType<typeof classifyAgentError> | undefined,
  });

  return Response.json(finalResult);
}

interface CaptureOpts {
  bin: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
}

interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
  spawnError?: string;
}

function runActionCapture(opts: CaptureOpts): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = safeSpawn(opts.bin, opts.args, { cwd: opts.cwd, signal: opts.signal });
    } catch (e) {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        durationMs: Date.now() - startedAt,
        truncated: false,
        spawnError: String(e),
      });
      return;
    }

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    // Distinct from `timedOut`: the child was SIGKILLed because its stdout
    // hit the byte cap, NOT because it ran too long or failed. This is an
    // expected, supported condition (the response carries `truncated: true`
    // and the UI shows a "· truncated" badge), so it must NOT be reported
    // as a failure — the captured output is still valid.
    let killedForOutputCap = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
    }, opts.timeoutMs);

    child.stdout?.on("data", (b: Buffer) => {
      if (outBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - outBytes;
        if (b.length > remaining) {
          out.push(b.subarray(0, remaining));
          outBytes += remaining;
          truncated = true;
        } else {
          out.push(b);
          outBytes += b.length;
        }
      }
      // If this chunk pushed us to OR past the cap, kill once. The previous
      // version only killed when `b.length > remaining`, so a chunk landing
      // exactly at the cap (`b.length === remaining`) left the child alive;
      // subsequent stdout was dropped silently and the process could keep
      // running until natural exit or timeout. Guarding on `killedForOutputCap`
      // avoids redundant SIGKILL calls on later chunks. We also flag
      // `truncated = true` here so the exact-cap case is reported to the UI
      // the same way as the overflow case (the `else` branch above only set
      // `truncated` when the chunk strictly exceeded `remaining`).
      if (outBytes >= MAX_OUTPUT_BYTES && !killedForOutputCap) {
        truncated = true;
        killedForOutputCap = true;
        try { child.kill("SIGKILL"); } catch { /* noop */ }
      }
    });
    child.stderr?.on("data", (b: Buffer) => {
      if (errBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - errBytes;
        const slice = b.length > remaining ? b.subarray(0, remaining) : b;
        err.push(slice);
        errBytes += slice.length;
        if (b.length > remaining) truncated = true;
      }
    });
    // No stdin for action invocations.
    try { child.stdin?.end(); } catch { /* ignore */ }

    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: null,
        durationMs: Date.now() - startedAt,
        truncated,
        spawnError: String(e.message),
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // Resolve exit semantics:
      // - timed out               → null (real failure: classified "timeout")
      // - killed for the byte cap → 0    (success; output valid but truncated)
      // - otherwise               → the real exit code
      const resolvedExit = timedOut
        ? null
        : killedForOutputCap
          ? 0
          : code;
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: resolvedExit,
        durationMs: Date.now() - startedAt,
        truncated,
      });
    });
  });
}

function neutralErrorMessage(errorClass: string, exitCode: number | null): string {
  switch (errorClass) {
    case "spawn-failed": return "command not found or not executable";
    case "timeout":      return "command timed out";
    case "killed":       return "command was terminated";
    case "non-zero-exit":
      return exitCode !== null ? `command exited with code ${exitCode}` : "command failed";
    default:             return "command failed";
  }
}
