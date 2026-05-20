// JSONL audit log per ADR-0009. One file per UTC day at:
//   ~/.agentic-os/audit/YYYY-MM-DD.jsonl
//
// Phase 1A kinds: agent.invoke, agent.invoke.complete, agent.invoke.error,
// vault.write. Other kinds reserved for later phases.
//
// HARD RULES (per SECURITY.md):
// - Raw prompts are NEVER logged. Only promptSha256 (first 8 hex chars) and
//   promptChars.
// - Secrets are NEVER logged. argsRedacted replaces any value matching a
//   secret env name with [REDACTED].

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Audit log location. Operator default is ~/.agentic-os/audit/. Tests (and
// any future need to redirect) can override via env var so they don't
// pollute the operator's real log. Evaluated lazily so tests can set the
// env var after import.
function auditDir(): string {
  return process.env["AGENTIC_OS_AUDIT_DIR"]
    ?? path.join(os.homedir(), ".agentic-os", "audit");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(auditDir(), { recursive: true });
}

export interface AuditEnvelope {
  ts: string;
  id: string;
  kind: string;
  [k: string]: unknown;
}

async function writeLine(record: { kind: string; [k: string]: unknown }): Promise<void> {
  await ensureDir();
  const envelope: AuditEnvelope = {
    ts: new Date().toISOString(),
    id: randomUUID(),
    ...record,
  };
  const line = JSON.stringify(envelope) + "\n";
  const file = path.join(auditDir(), `${todayUtc()}.jsonl`);
  await fs.appendFile(file, line, "utf8");
}

export function sha8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

// Redact any arg that looks like a secret (matches known env names or
// header-shaped values). For Phase 1A this is conservative — args containing
// "{prompt}" placeholder text won't have raw prompt content, so the main risk
// is later when http transport lands. Keep the function ready now.
const SECRET_HINT = /(API_KEY|TOKEN|SECRET|PASSWORD|Bearer\s+)/i;

export function redactArgs(args: readonly string[]): string[] {
  return args.map((a) => (SECRET_HINT.test(a) ? "[REDACTED]" : a));
}

// ────────────────────────────────────────────────────────────────────────
// Public API — one helper per kind we emit in Phase 1A.

export async function auditAgentInvoke(input: {
  agent: string;
  transport: string;
  bin: string;
  argsRedacted: string[];
  prompt: string;
}): Promise<void> {
  await writeLine({
    kind: "agent.invoke",
    agent: input.agent,
    transport: input.transport,
    bin: input.bin,
    argsRedacted: input.argsRedacted,
    promptSha256: sha8(input.prompt),
    promptChars: input.prompt.length,
  });
}

export async function auditAgentInvokeComplete(input: {
  agent: string;
  durationMs: number;
  exitCode: number | null;
  bytesOut: number;
  // Optional explicit status. When omitted, derives from `exitCode`
  // (0 → "success", anything else → "error"). Callers pass
  // "cancelled" when the run ended because the caller's AbortController
  // fired (Stop button / route navigation / page reload). Cancellation
  // must NOT be audited as a failure — see F4 contract.
  status?: "success" | "cancelled" | "error";
}): Promise<void> {
  const status: "success" | "cancelled" | "error" =
    input.status ?? (input.exitCode === 0 ? "success" : "error");
  await writeLine({
    kind: "agent.invoke.complete",
    agent: input.agent,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    bytesOut: input.bytesOut,
    status,
  });
}

export type AgentErrorClass =
  | "non-zero-exit"
  | "spawn-failed"
  | "timeout"
  | "killed"
  | "transport-error"
  | "unknown";

/**
 * Classify a raw error message + exit code into a neutral category. The
 * classifier never returns prompt-derived strings; the message is only
 * inspected for known error keywords. Used by the registry before writing
 * to the audit log so raw stderr/error text never leaks into JSONL.
 */
export function classifyAgentError(input: {
  message: string;
  exitCode: number | null;
}): AgentErrorClass {
  const m = (input.message ?? "").toLowerCase();
  if (m.includes("enoent") || m.includes(" not found") || m.includes("spawn ")) return "spawn-failed";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  if (input.exitCode === null) return "killed";
  if (typeof input.exitCode === "number" && input.exitCode !== 0) return "non-zero-exit";
  if ((input.message ?? "").length > 0) return "transport-error";
  return "unknown";
}

/**
 * Audit the failure of an agent invocation. **Never** accepts a raw
 * stderr / error message — that text could contain the prompt, secrets,
 * or other operator content. Caller must pre-classify and pre-hash.
 */
export async function auditAgentInvokeError(input: {
  agent: string;
  errorClass: AgentErrorClass;
  exitCode?: number | null;
  stderrSha8?: string;            // sha8 of the original stderr for correlation
  stderrChars?: number;           // length only, not content
  transport?: string;             // manifest's transport name
}): Promise<void> {
  await writeLine({
    kind: "agent.invoke.error",
    agent: input.agent,
    errorClass: input.errorClass,
    ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
    ...(input.stderrSha8 ? { stderrSha8: input.stderrSha8 } : {}),
    ...(input.stderrChars !== undefined ? { stderrChars: input.stderrChars } : {}),
    ...(input.transport ? { transport: input.transport } : {}),
  });
}

/**
 * Audit an agent-action invocation (Status / Sessions / Insights chips in
 * the AgentRoom rail — read-only CLI verbs declared in the manifest's
 * `actions:` block).
 *
 * SECURITY: Action stdout/stderr can contain operator-private content
 * (Hermes sessions list echoes prompt previews; insights export model
 * output). Per ADR-0009 / SECURITY.md the raw text MUST NOT land in the
 * JSONL log. This helper records the action id, exit code, byte lengths,
 * and a neutral error class only — same shape contract as
 * auditAgentInvokeError.
 */
export async function auditAgentAction(input: {
  agent: string;
  actionId: string;
  exitCode: number | null;
  durationMs: number;
  stdoutChars: number;
  stderrChars: number;
  errorClass?: AgentErrorClass;
}): Promise<void> {
  await writeLine({
    kind: "agent.action",
    agent: input.agent,
    actionId: input.actionId,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    stdoutChars: input.stdoutChars,
    stderrChars: input.stderrChars,
    ...(input.errorClass ? { errorClass: input.errorClass } : {}),
    status: input.exitCode === 0 ? "success" : "error",
  });
}

export async function auditVaultWrite(input: {
  agent: string;
  path: string;
  action: "create" | "append" | "promote";
  bytes: number;
}): Promise<void> {
  await writeLine({
    kind: "vault.write",
    agent: input.agent,
    path: input.path,
    action: input.action,
    bytes: input.bytes,
  });
}

/**
 * Audit one mission run (Phase 1C — M4). Records counts + status only:
 * NO vault paths, NO mission options, NO note content — a mission's
 * options or output path could carry operator-private strings.
 */
export async function auditMissionRun(input: {
  missionId: string;
  runId: string;
  trigger: string;
  status: "success" | "skipped" | "failed";
  durationMs: number;
  outputsPersisted: number;
  outputsEmitted: number;
  errorClass?: string;
}): Promise<void> {
  await writeLine({
    kind: "mission.run",
    missionId: input.missionId,
    runId: input.runId,
    trigger: input.trigger,
    status: input.status,
    durationMs: input.durationMs,
    outputsPersisted: input.outputsPersisted,
    outputsEmitted: input.outputsEmitted,
    ...(input.errorClass ? { errorClass: input.errorClass } : {}),
  });
}

export const AUDIT_TEST_HELPERS = { auditDir, todayUtc };
