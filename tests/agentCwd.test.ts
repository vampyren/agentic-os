import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  clearAgentCwd,
  getAgentCwd,
  setAgentCwd,
  snapshotAgentCwd,
} from "../src/kernel/agentCwd";
import { chatStore } from "../src/lib/chatStore";

// Use a fresh temp file per suite — AGENTIC_OS_AGENT_CWD_FILE points at it,
// so the kernel module reads/writes there instead of ~/.agentic-os/.
// Same isolation pattern used by other kernel state-file modules.

let tmpFile: string;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-cwd-test-"));
  tmpFile = path.join(tmpDir, "agent-cwd.json");
  process.env.AGENTIC_OS_AGENT_CWD_FILE = tmpFile;
});

afterEach(async () => {
  delete process.env.AGENTIC_OS_AGENT_CWD_FILE;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("agentCwd", () => {
  describe("getAgentCwd", () => {
    it("returns $HOME/Documents when no JSON file exists", async () => {
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(path.join(os.homedir(), "Documents"));
    });

    it("returns $HOME/Documents when no entry for the agent", async () => {
      await fs.writeFile(tmpFile, JSON.stringify({ "other-agent": tmpDir }), "utf8");
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(path.join(os.homedir(), "Documents"));
    });

    it("returns the persisted path when it points to an existing directory", async () => {
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": tmpDir }), "utf8");
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(tmpDir);
    });

    it("falls back to default when the persisted path no longer exists", async () => {
      const ghost = path.join(tmpDir, "does-not-exist");
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": ghost }), "utf8");
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(path.join(os.homedir(), "Documents"));
    });

    it("falls back to default when the persisted path is a file (not a dir)", async () => {
      const filePath = path.join(tmpDir, "a-file.txt");
      await fs.writeFile(filePath, "hi", "utf8");
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": filePath }), "utf8");
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(path.join(os.homedir(), "Documents"));
    });

    it("treats an unparsable JSON file as 'no persisted value'", async () => {
      await fs.writeFile(tmpFile, "{ not json", "utf8");
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(path.join(os.homedir(), "Documents"));
    });
  });

  describe("setAgentCwd", () => {
    it("rejects empty / missing input", async () => {
      const a = await setAgentCwd("claude-code", undefined);
      const b = await setAgentCwd("claude-code", "");
      expect(a.ok).toBe(false);
      expect(b.ok).toBe(false);
    });

    it("rejects relative paths", async () => {
      const r = await setAgentCwd("claude-code", "relative/path");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/absolute/i);
    });

    it("rejects non-existent absolute paths", async () => {
      const ghost = path.join(tmpDir, "missing");
      const r = await setAgentCwd("claude-code", ghost);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/does not exist/i);
    });

    it("rejects a path that points to a file", async () => {
      const filePath = path.join(tmpDir, "a-file.txt");
      await fs.writeFile(filePath, "hi", "utf8");
      const r = await setAgentCwd("claude-code", filePath);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not a directory/i);
    });

    it("accepts a valid directory under $HOME with no warning", async () => {
      const home = os.homedir();
      // Use $HOME itself if we can stat it — every test environment has it.
      const r = await setAgentCwd("claude-code", home);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.path).toBe(home);
        expect(r.warning).toBeUndefined();
      }
    });

    it("accepts a path outside $HOME but flags a warning", async () => {
      // /tmp is outside $HOME on every supported platform.
      const outside = os.tmpdir();
      const r = await setAgentCwd("claude-code", outside);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warning).toMatch(/outside \$HOME/i);
    });

    it("persists across reads — getAgentCwd reflects the most recent write", async () => {
      const r = await setAgentCwd("claude-code", tmpDir);
      expect(r.ok).toBe(true);
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBe(tmpDir);
    });

    it("creates ~/.agentic-os/ implicitly when the parent dir is missing", async () => {
      // The tmpDir already exists (it IS the parent of tmpFile). Sanity-check
      // the write doesn't throw.
      await expect(setAgentCwd("claude-code", tmpDir)).resolves.toMatchObject({
        ok: true,
      });
      // File got written.
      const raw = await fs.readFile(tmpFile, "utf8");
      expect(raw).toContain("claude-code");
    });
  });

  describe("clearAgentCwd", () => {
    it("removes the entry so getAgentCwd reverts to default", async () => {
      await setAgentCwd("claude-code", tmpDir);
      expect(await getAgentCwd("claude-code")).toBe(tmpDir);
      await clearAgentCwd("claude-code");
      expect(await getAgentCwd("claude-code")).toBe(path.join(os.homedir(), "Documents"));
    });

    it("is a no-op when the entry doesn't exist", async () => {
      await expect(clearAgentCwd("ghost")).resolves.toBeUndefined();
    });
  });

  describe("isolation from chatStore", () => {
    // Pins the structural invariant: chatStore.newSession only touches
    // chat history + sessionUsage; it must NOT clear the per-agent
    // working-directory persistence. Without this test, a well-meaning
    // future change to `clear everything for the agent` could silently
    // wipe the operator's saved cwd on every New Session click.
    it("chatStore.newSession leaves the persisted agent cwd untouched", async () => {
      await setAgentCwd("claude-code", tmpDir);
      expect(await getAgentCwd("claude-code")).toBe(tmpDir);

      // Drive the chatStore lifecycle: append a turn, then reset.
      chatStore.appendUserMessage("claude-code", "prompt");
      chatStore.appendAssistantMessage("claude-code", {
        role: "assistant",
        text: "x",
        ts: Date.now(),
        usage: { model: "claude-opus-4-7", inputTokens: 1, outputTokens: 1 },
      });
      chatStore.newSession("claude-code");

      // The persisted cwd survives the reset.
      expect(await getAgentCwd("claude-code")).toBe(tmpDir);
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.persisted).toBe(true);
      expect(snap.cwd).toBe(tmpDir);
    });
  });

  describe("snapshotAgentCwd", () => {
    it("reports persisted=false + default cwd when no entry exists", async () => {
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.agent).toBe("claude-code");
      expect(snap.cwd).toBe(path.join(os.homedir(), "Documents"));
      expect(snap.persisted).toBe(false);
      expect(snap.defaultCwd).toBe(path.join(os.homedir(), "Documents"));
    });

    it("reports persisted=true + persisted cwd when entry is valid", async () => {
      await setAgentCwd("claude-code", tmpDir);
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.persisted).toBe(true);
      expect(snap.cwd).toBe(tmpDir);
    });

    it("reports persisted=false when stored path no longer exists", async () => {
      const ghost = path.join(tmpDir, "missing");
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": ghost }), "utf8");
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.persisted).toBe(false);
      expect(snap.cwd).toBe(path.join(os.homedir(), "Documents"));
    });
  });
});
