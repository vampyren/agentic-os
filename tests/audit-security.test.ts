// Audit log security: raw prompts must NEVER end up in ~/.agentic-os/audit/.
// This is the nonce test ADR-0009 promised — pass a unique string as the
// prompt, write the audit entry, then grep the file for the nonce.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  auditAgentInvoke,
  auditAgentInvokeComplete,
  auditVaultWrite,
  AUDIT_TEST_HELPERS,
} from "../src/kernel/audit";

let auditDir: string;
const prevAuditEnv = process.env["AGENTIC_OS_AUDIT_DIR"];

beforeAll(async () => {
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-audit-sec-"));
  process.env["AGENTIC_OS_AUDIT_DIR"] = auditDir;
});

afterAll(async () => {
  if (prevAuditEnv === undefined) delete process.env["AGENTIC_OS_AUDIT_DIR"];
  else process.env["AGENTIC_OS_AUDIT_DIR"] = prevAuditEnv;
  await fs.rm(auditDir, { recursive: true, force: true });
});

async function readTodayLog(): Promise<string> {
  const file = path.join(auditDir, `${AUDIT_TEST_HELPERS.todayUtc()}.jsonl`);
  try { return await fs.readFile(file, "utf8"); }
  catch { return ""; }
}

describe("audit log security", () => {
  it("never writes the raw prompt — only promptSha256 + promptChars", async () => {
    const nonce = "NONCE_a8x2j7_DO_NOT_LOG_ME_VERBATIM_in_audit_log";
    await auditAgentInvoke({
      agent: "test-agent",
      transport: "subprocess",
      bin: "test",
      // argsRedacted comes already-redacted from the registry; this test
      // also verifies the audit module itself doesn't introduce a leak path.
      argsRedacted: ["-p", "[PROMPT_REDACTED]"],
      prompt: nonce,
    });
    const content = await readTodayLog();
    expect(content).toContain('"promptSha256"');
    expect(content).toContain('"promptChars"');
    expect(content).not.toContain(nonce);
  });

  it("auditAgentInvokeComplete does not need a prompt and does not leak one", async () => {
    await auditAgentInvokeComplete({
      agent: "test-agent",
      durationMs: 42,
      exitCode: 0,
      bytesOut: 100,
    });
    const content = await readTodayLog();
    expect(content).toContain("agent.invoke.complete");
  });

  it("auditVaultWrite stores the relative path (not a secret) verbatim", async () => {
    await auditVaultWrite({
      agent: "test-agent",
      path: "00_Inbox/agentic-os/chats/2026-05-16-test.md",
      action: "create",
      bytes: 200,
    });
    const content = await readTodayLog();
    expect(content).toContain("00_Inbox/agentic-os/chats/");
    expect(content).toContain("vault.write");
  });

  it("audit log is JSONL — one valid JSON object per non-empty line", async () => {
    const content = await readTodayLog();
    const lines = content.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
