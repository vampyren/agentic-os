// Regression test for SEC-001 (Hermes review of v0.2.3):
// transport stderr / error messages must never reach the audit JSONL.
//
// Strategy: drive a real subprocess via the subprocess transport (so we
// exercise the actual code path, not a mock), have it echo a unique nonce
// to stderr and exit non-zero. Walk the auditAgentInvokeError flow the
// same way the registry does. Assert the nonce appears nowhere in the
// JSONL file.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSubprocessTransport } from "../src/kernel/transports/subprocess";
import type { AgentManifest, AgentEvent } from "../src/kernel/types";
import {
  auditAgentInvokeError,
  classifyAgentError,
  sha8,
  AUDIT_TEST_HELPERS,
} from "../src/kernel/audit";

let auditDir: string;
const prevAuditEnv = process.env["AGENTIC_OS_AUDIT_DIR"];

beforeAll(async () => {
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-stderr-sec-"));
  process.env["AGENTIC_OS_AUDIT_DIR"] = auditDir;
});

afterAll(async () => {
  if (prevAuditEnv === undefined) delete process.env["AGENTIC_OS_AUDIT_DIR"];
  else process.env["AGENTIC_OS_AUDIT_DIR"] = prevAuditEnv;
  await fs.rm(auditDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Start each test with an empty audit dir so assertions are scoped.
  await fs.rm(auditDir, { recursive: true, force: true });
  await fs.mkdir(auditDir, { recursive: true });
});

async function readTodayAudit(): Promise<string> {
  const file = path.join(auditDir, `${AUDIT_TEST_HELPERS.todayUtc()}.jsonl`);
  try { return await fs.readFile(file, "utf8"); }
  catch { return ""; }
}

function assertNoNonceAnywhere(audit: string, nonce: string): void {
  if (audit.includes(nonce)) {
    const lines = audit.split("\n").filter((l) => l.includes(nonce));
    throw new Error(`nonce "${nonce}" leaked into audit. Lines:\n${lines.join("\n")}`);
  }
  for (const line of audit.split("\n").filter((l) => l.trim())) {
    const entry = JSON.parse(line);
    function walk(v: unknown): void {
      if (typeof v === "string") expect(v).not.toContain(nonce);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    }
    walk(entry);
  }
}

function makeStderrEchoingManifest(): AgentManifest {
  return {
    name: "stderr-echo-test",
    displayName: "stderr-echo-test",
    transport: "subprocess",
    transportConfig: {
      // /bin/sh -c "<the prompt as a shell command>"
      // The prompt is rendered into the {prompt} slot; we'll send a prompt
      // that echoes a nonce to stderr and exits non-zero. That puts the
      // nonce on the subprocess's stderr stream, which the transport reads
      // into evt.message — exactly the path Hermes flagged.
      bin: "/bin/sh",
      args: ["-c", "{prompt}"],
      timeoutMs: 5000,
      cwd: "/tmp",
    },
  };
}

describe("audit stderr security — SEC-001 regression", () => {
  it("stderr containing a prompt nonce does not appear anywhere in audit JSONL", async () => {
    const nonce = "STDERR_LEAK_NONCE_p4q8w2";
    const transport = createSubprocessTransport(makeStderrEchoingManifest());

    // Drive the transport's stream and accumulate the same way the registry
    // does, then call auditAgentInvokeError with the neutral fields.
    let errored = false;
    let errorMessage = "";
    let exitCode: number | null = null;

    const prompt = `echo "${nonce} on stderr" >&2; exit 7`;
    for await (const evt of transport.stream({ prompt, cwd: "/tmp" }) as AsyncIterable<AgentEvent>) {
      if (evt.kind === "error") { errored = true; errorMessage = evt.message; }
      else if (evt.kind === "done") exitCode = evt.exitCode ?? null;
    }

    expect(errored).toBe(true);
    expect(errorMessage).toContain(nonce);          // sanity: stderr captured by transport
    expect(exitCode).toBe(7);

    // This is the v0.2.4 fix: registry MUST translate stderr into neutral
    // audit fields, not pass the raw message through.
    await auditAgentInvokeError({
      agent: "stderr-echo-test",
      errorClass: classifyAgentError({ message: errorMessage, exitCode }),
      exitCode,
      stderrSha8: sha8(errorMessage),
      stderrChars: errorMessage.length,
      transport: "subprocess",
    });

    const audit = await readTodayAudit();
    expect(audit.length).toBeGreaterThan(0);

    // The headline assertion: nonce nowhere in the audit JSONL.
    assertNoNonceAnywhere(audit, nonce);

    // Sanity: the entry still carries enough metadata to debug a failure.
    const entry = JSON.parse(audit.trim().split("\n").pop()!);
    expect(entry.kind).toBe("agent.invoke.error");
    expect(entry.errorClass).toBe("non-zero-exit");
    expect(entry.exitCode).toBe(7);
    expect(entry.stderrChars).toBeGreaterThan(0);
    expect(entry.stderrSha8).toMatch(/^[0-9a-f]{8}$/);
    expect(entry.transport).toBe("subprocess");
  });

  it("classifyAgentError buckets stderr text into neutral categories", () => {
    expect(classifyAgentError({ message: "spawn /nonexistent ENOENT", exitCode: -1 })).toBe("spawn-failed");
    expect(classifyAgentError({ message: "operation timed out after 5s", exitCode: -1 })).toBe("timeout");
    expect(classifyAgentError({ message: "any error", exitCode: 1 })).toBe("non-zero-exit");
    expect(classifyAgentError({ message: "", exitCode: null })).toBe("killed");
    expect(classifyAgentError({ message: "stderr noise", exitCode: 0 })).toBe("transport-error");
    expect(classifyAgentError({ message: "", exitCode: 0 })).toBe("unknown");
  });

  it("classifyAgentError never returns a string that contains the input prompt", () => {
    // Defense-in-depth: the classifier reads the message but its output
    // is from a fixed enum, so even a crafted prompt can't slip through.
    const promptish = "MYAPI_KEY=sk-secret-XYZ should not appear";
    const cls = classifyAgentError({ message: promptish, exitCode: 1 });
    expect(["non-zero-exit", "spawn-failed", "timeout", "killed", "transport-error", "unknown"])
      .toContain(cls);
    expect(cls).not.toContain("sk-secret");
    expect(cls).not.toContain("MYAPI_KEY");
  });
});
