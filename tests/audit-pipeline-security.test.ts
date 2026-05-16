// Full-pipeline regression test: a unique nonce in the prompt must NOT
// appear anywhere in the audit JSONL — not in argsRedacted, not in any
// vault.write `path` field, not in any payload, not anywhere.
//
// This guards against the v0.2.2 residual leak where chat filenames
// derived from slugified prompt prefixes appeared in `vault.write` audit
// entries. Fixed in v0.2.3 by hashing the prompt into the filename.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeDraft } from "../src/vault/writer";
import { auditAgentInvoke, AUDIT_TEST_HELPERS } from "../src/kernel/audit";
import { renderArgsForAudit } from "../src/kernel/spawn";

let auditDir: string;
let vaultRoot: string;
const prevAuditEnv = process.env["AGENTIC_OS_AUDIT_DIR"];

beforeAll(async () => {
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-pipeline-audit-"));
  process.env["AGENTIC_OS_AUDIT_DIR"] = auditDir;
});

afterAll(async () => {
  if (prevAuditEnv === undefined) delete process.env["AGENTIC_OS_AUDIT_DIR"];
  else process.env["AGENTIC_OS_AUDIT_DIR"] = prevAuditEnv;
  await fs.rm(auditDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-pipeline-vault-"));
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

async function readTodayAuditAsString(): Promise<string> {
  const file = path.join(auditDir, `${AUDIT_TEST_HELPERS.todayUtc()}.jsonl`);
  try { return await fs.readFile(file, "utf8"); }
  catch { return ""; }
}

function assertNoNonceAnywhere(audit: string, nonce: string): void {
  // Raw string scan.
  if (audit.includes(nonce)) {
    // Find which line(s) leaked so the failure message is useful.
    const offending = audit.split("\n").filter((l) => l.includes(nonce));
    throw new Error(
      `nonce "${nonce}" found in audit log. Offending lines:\n${offending.join("\n")}`,
    );
  }
  // Per-entry deep scan — if a future change adds a field whose serialized
  // form is different from the raw concat, this still catches it.
  for (const line of audit.split("\n").filter((l) => l.trim())) {
    const entry = JSON.parse(line);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(nonce);
    // Recursive walk in case JSON.stringify changes representation:
    function walk(v: unknown): void {
      if (typeof v === "string") {
        expect(v).not.toContain(nonce);
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === "object") {
        Object.values(v).forEach(walk);
      }
    }
    walk(entry);
  }
}

describe("audit pipeline — no prompt leakage anywhere in the JSONL", () => {
  it("chat filename derived from prompt hash, NOT from prompt text", async () => {
    const nonce = "REGRESSION_NONCE_q9k2x7_must_not_leak";
    const fullPrompt = `${nonce} please reply with the single word OK and nothing else.`;

    const result = await writeDraft({
      vaultRoot,
      agent: "claude-code",
      kind: "chat",
      title: fullPrompt.slice(0, 60),
      filenameSeed: fullPrompt,
      body: `## prompt\n\n${fullPrompt}\n\n## response\n\nOK\n`,
      tags: [],
    });

    // Sanity: the file ON DISK contains the nonce — that's the operator's
    // chat body, fine. We're not testing the markdown file, we're testing
    // the audit log.
    const fileContent = await fs.readFile(result.absolutePath, "utf8");
    expect(fileContent).toContain(nonce);

    // The filename itself must be hash-suffixed, never the slug.
    expect(path.basename(result.path)).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-claude-code-[0-9a-f]{8}\.md$/);
    expect(path.basename(result.path)).not.toContain("regression");
    expect(path.basename(result.path).toLowerCase()).not.toContain("nonce");

    // The audit log must not contain the nonce ANYWHERE.
    const audit = await readTodayAuditAsString();
    assertNoNonceAnywhere(audit, nonce);
  });

  it("auditAgentInvoke path is also clean (uses renderArgsForAudit)", async () => {
    const nonce = "ANOTHER_NONCE_v3k7m2_in_invoke";
    // Simulate what the registry does: it builds argsForAudit by mapping
    // the manifest's args template through renderArgsForAudit, which
    // substitutes {prompt} -> [PROMPT_REDACTED] (never the real prompt).
    const argsForAudit = renderArgsForAudit(["-p", "{prompt}", "--verbose"]);
    await auditAgentInvoke({
      agent: "claude-code",
      transport: "streamJson",
      bin: "claude",
      argsRedacted: argsForAudit,
      prompt: nonce + " full prompt content",
    });

    const audit = await readTodayAuditAsString();
    assertNoNonceAnywhere(audit, nonce);
  });

  it("full simulated round-trip: invoke + vault.write, single audit file", async () => {
    const nonce = "ROUND_TRIP_NONCE_b5p8q1";
    const fullPrompt = `${nonce} please respond minimally`;

    // 1. Agent invocation (audit.invoke)
    await auditAgentInvoke({
      agent: "claude-code",
      transport: "streamJson",
      bin: "claude",
      argsRedacted: renderArgsForAudit(["-p", "{prompt}"]),
      prompt: fullPrompt,
    });

    // 2. Vault write of the resulting chat note
    await writeDraft({
      vaultRoot,
      agent: "claude-code",
      kind: "chat",
      title: fullPrompt.slice(0, 60),
      filenameSeed: fullPrompt,
      body: `## prompt\n\n${fullPrompt}\n\n## response\n\nOK\n`,
    });

    const audit = await readTodayAuditAsString();
    expect(audit.length).toBeGreaterThan(0);
    assertNoNonceAnywhere(audit, nonce);

    // Sanity: the audit log DID receive the entries (otherwise the
    // assertion above is vacuous).
    expect(audit).toContain('"agent.invoke"');
    expect(audit).toContain('"vault.write"');
  });

  it("non-chat kinds (operator-authored titles) still slug normally", async () => {
    // Operator goals use slug — that's not a leak because the title is
    // not prompt content, it's what the operator typed into the goals form.
    const result = await writeDraft({
      vaultRoot,
      agent: "operator",
      kind: "goal",
      title: "ship phase 1C scheduler",
      body: "",
    });
    expect(path.basename(result.path)).toMatch(/^\d{4}-\d{2}-\d{2}-ship-phase-1c-scheduler\.md$/);
  });
});
