// Vault writer: inbox-first contract, collision-safe naming, atomic write,
// path-traversal protection.

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeDraft, __TEST__ } from "../src/vault/writer";

let vaultRoot: string;
let auditDir: string;
const prevAuditEnv = process.env["AGENTIC_OS_AUDIT_DIR"];

beforeAll(async () => {
  // Redirect the JSONL audit log to a throwaway tmp dir so writer tests
  // never pollute the operator's ~/.agentic-os/audit/.
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-audit-"));
  process.env["AGENTIC_OS_AUDIT_DIR"] = auditDir;
});

afterAll(async () => {
  if (prevAuditEnv === undefined) delete process.env["AGENTIC_OS_AUDIT_DIR"];
  else process.env["AGENTIC_OS_AUDIT_DIR"] = prevAuditEnv;
  await fs.rm(auditDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-vault-"));
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

describe("vault writer", () => {
  it("writes the first note at the bare filename and the second with -02 suffix", async () => {
    const a = await writeDraft({
      vaultRoot,
      agent: "test-agent",
      kind: "summary",
      title: "duplicate slug test",
      body: "first body",
    });
    const b = await writeDraft({
      vaultRoot,
      agent: "test-agent",
      kind: "summary",
      title: "duplicate slug test",
      body: "second body",
    });

    expect(a.path).toMatch(/00_Inbox\/agentic-os\/summaries\/\d{4}-\d{2}-\d{2}-duplicate-slug-test\.md$/);
    expect(b.path).toMatch(/00_Inbox\/agentic-os\/summaries\/\d{4}-\d{2}-\d{2}-duplicate-slug-test-02\.md$/);

    const aContent = await fs.readFile(a.absolutePath, "utf8");
    const bContent = await fs.readFile(b.absolutePath, "utf8");
    expect(aContent).toContain("first body");
    expect(bContent).toContain("second body");
  });

  it("writes a third collision with -03 suffix", async () => {
    for (let i = 0; i < 2; i++) {
      await writeDraft({
        vaultRoot,
        agent: "x",
        kind: "summary",
        title: "triple",
        body: `body ${i}`,
      });
    }
    const third = await writeDraft({
      vaultRoot,
      agent: "x",
      kind: "summary",
      title: "triple",
      body: "body 3",
    });
    expect(third.path).toMatch(/-03\.md$/);
  });

  it("refuses to write outside the inbox-first directory", () => {
    // Sanity-check the assertion: an absolute path *outside* the expected
    // root must throw.
    expect(() =>
      __TEST__.assertInsideInbox(
        path.join(vaultRoot, "40_Decisions", "something.md"),
        vaultRoot,
      ),
    ).toThrow(/outside/);

    // A traversal attempt: ../../etc/passwd-shaped path.
    expect(() =>
      __TEST__.assertInsideInbox(
        path.resolve(vaultRoot, "00_Inbox", "agentic-os", "..", "..", "evil.md"),
        vaultRoot,
      ),
    ).toThrow(/outside/);
  });

  it("emits valid YAML frontmatter at the top of the file", async () => {
    const r = await writeDraft({
      vaultRoot,
      agent: "claude-code",
      kind: "chat",
      title: "what is the meaning of life",
      body: "## prompt\n\nq\n\n## response\n\n42\n",
      tags: ["ai", "this-tag-is-not-approved-and-should-be-dropped"],
    });
    const content = await fs.readFile(r.absolutePath, "utf8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("type: chat");
    expect(content).toContain("status: draft");
    expect(content).toContain("agent: claude-code");
    expect(content).toContain("- ai");
    // Non-approved tag must have been filtered out.
    expect(content).not.toContain("this-tag-is-not-approved");
    // Title heading appears below frontmatter, not above.
    expect(content.indexOf("# what is the meaning of life"))
      .toBeGreaterThan(content.indexOf("---\n"));
  });
});
