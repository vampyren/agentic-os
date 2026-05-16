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
}): Promise<void> {
  await writeLine({
    kind: "agent.invoke.complete",
    agent: input.agent,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    bytesOut: input.bytesOut,
    status: input.exitCode === 0 ? "success" : "error",
  });
}

export async function auditAgentInvokeError(input: {
  agent: string;
  message: string;
}): Promise<void> {
  await writeLine({
    kind: "agent.invoke.error",
    agent: input.agent,
    message: input.message,
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

export const AUDIT_TEST_HELPERS = { auditDir, todayUtc };
