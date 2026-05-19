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

// Test isolation:
//   - AGENTIC_OS_AGENT_CWD_FILE points the kernel module at a fresh
//     tmp file so reads/writes don't touch ~/.agentic-os/.
//   - HOME points at a fresh tmp dir for the tests that exercise the
//     ~/Documents-or-$HOME fallback. We always restore the original
//     HOME afterwards so other tests aren't affected.

let tmpFile: string;
let tmpDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-cwd-test-"));
  tmpFile = path.join(tmpDir, "agent-cwd.json");
  process.env.AGENTIC_OS_AGENT_CWD_FILE = tmpFile;
  originalHome = process.env.HOME;
});

afterEach(async () => {
  delete process.env.AGENTIC_OS_AGENT_CWD_FILE;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("agentCwd", () => {
  describe("getAgentCwd — per-agent defaults", () => {
    it("returns undefined for an agent with NO persisted value AND no configured default", async () => {
      // 'hermes' is not in PER_AGENT_DEFAULT — undefined means the
      // run route should NOT pass opts.cwd, so the transport's
      // manifest cfg.cwd / process default takes over.
      const cwd = await getAgentCwd("hermes");
      expect(cwd).toBeUndefined();
    });

    it("returns the configured per-agent default for claude-code when no persisted value exists", async () => {
      // Default points at the real ~/Documents (or $HOME if absent).
      // We're not overriding HOME here, so this just checks the
      // resolver returns a non-empty absolute path that exists.
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).toBeDefined();
      expect(path.isAbsolute(cwd!)).toBe(true);
      const stat = await fs.stat(cwd!);
      expect(stat.isDirectory()).toBe(true);
    });

    it("returns the persisted value when one is set (for any agent)", async () => {
      await setAgentCwd("hermes", tmpDir);
      expect(await getAgentCwd("hermes")).toBe(tmpDir);
      await setAgentCwd("claude-code", tmpDir);
      expect(await getAgentCwd("claude-code")).toBe(tmpDir);
    });

    it("falls back to default when persisted path no longer exists (claude-code)", async () => {
      const ghost = path.join(tmpDir, "does-not-exist");
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": ghost }), "utf8");
      const cwd = await getAgentCwd("claude-code");
      // Default = real ~/Documents-or-$HOME, NOT the ghost path.
      expect(cwd).not.toBe(ghost);
      expect(cwd).toBeDefined();
    });

    it("falls back to undefined when persisted path no longer exists (non-defaulted agent)", async () => {
      const ghost = path.join(tmpDir, "does-not-exist");
      await fs.writeFile(tmpFile, JSON.stringify({ "hermes": ghost }), "utf8");
      const cwd = await getAgentCwd("hermes");
      expect(cwd).toBeUndefined();
    });

    it("falls back to default when persisted path is a file, not a directory", async () => {
      const filePath = path.join(tmpDir, "a-file.txt");
      await fs.writeFile(filePath, "hi", "utf8");
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": filePath }), "utf8");
      const cwd = await getAgentCwd("claude-code");
      expect(cwd).not.toBe(filePath);
      expect(cwd).toBeDefined();
    });

    it("treats an unparsable JSON file as 'no persisted value'", async () => {
      await fs.writeFile(tmpFile, "{ not json", "utf8");
      // For claude-code: still returns default.
      expect(await getAgentCwd("claude-code")).toBeDefined();
      // For hermes: undefined.
      expect(await getAgentCwd("hermes")).toBeUndefined();
    });
  });

  describe("default cwd robustness — ~/Documents fallback", () => {
    it("returns $HOME when ~/Documents does not exist", async () => {
      // Point HOME at a fresh tmp dir with no Documents subdir. The
      // default resolver should detect Documents missing and fall
      // back to HOME itself.
      const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "fake-home-"));
      try {
        process.env.HOME = fakeHome;
        const cwd = await getAgentCwd("claude-code");
        expect(cwd).toBe(fakeHome);
      } finally {
        await fs.rm(fakeHome, { recursive: true, force: true });
      }
    });

    it("returns $HOME/Documents when it exists and is a directory", async () => {
      const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "fake-home-"));
      const docs = path.join(fakeHome, "Documents");
      try {
        await fs.mkdir(docs);
        process.env.HOME = fakeHome;
        const cwd = await getAgentCwd("claude-code");
        expect(cwd).toBe(docs);
      } finally {
        await fs.rm(fakeHome, { recursive: true, force: true });
      }
    });

    it("returns $HOME when ~/Documents exists but is a regular file", async () => {
      const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "fake-home-"));
      const docs = path.join(fakeHome, "Documents");
      try {
        await fs.writeFile(docs, "not-a-dir", "utf8");
        process.env.HOME = fakeHome;
        const cwd = await getAgentCwd("claude-code");
        expect(cwd).toBe(fakeHome);
      } finally {
        await fs.rm(fakeHome, { recursive: true, force: true });
      }
    });
  });

  describe("setAgentCwd validation", () => {
    it("rejects empty / missing input", async () => {
      expect((await setAgentCwd("claude-code", undefined)).ok).toBe(false);
      expect((await setAgentCwd("claude-code", "")).ok).toBe(false);
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
      const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "fake-home-"));
      try {
        process.env.HOME = fakeHome;
        const inside = path.join(fakeHome, "subdir");
        await fs.mkdir(inside);
        const r = await setAgentCwd("claude-code", inside);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.path).toBe(inside);
          expect(r.warning).toBeUndefined();
        }
      } finally {
        await fs.rm(fakeHome, { recursive: true, force: true });
      }
    });

    it("accepts a path outside $HOME but flags a warning", async () => {
      const outside = os.tmpdir();
      const r = await setAgentCwd("claude-code", outside);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warning).toMatch(/outside \$HOME/i);
    });

    it("uses realpath for the $HOME check — symlinks pointing outside warn", async () => {
      // Build: a fake $HOME with a symlink that lexically lives under
      // HOME but resolves to an outside directory. The realpath check
      // should trip the warning even though the lexical path is inside.
      const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "fake-home-"));
      const outsideTarget = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
      const linkInsideHome = path.join(fakeHome, "link-to-outside");
      try {
        process.env.HOME = fakeHome;
        await fs.symlink(outsideTarget, linkInsideHome);
        const r = await setAgentCwd("claude-code", linkInsideHome);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.warning).toMatch(/outside \$HOME/i);
      } finally {
        await fs.rm(linkInsideHome, { force: true });
        await fs.rm(outsideTarget, { recursive: true, force: true });
        await fs.rm(fakeHome, { recursive: true, force: true });
      }
    });

    it("persists across reads — getAgentCwd reflects the most recent write", async () => {
      await setAgentCwd("hermes", tmpDir);
      expect(await getAgentCwd("hermes")).toBe(tmpDir);
    });
  });

  describe("persistence safety", () => {
    it("uses atomic write — config file always contains a valid JSON document", async () => {
      // Atomic-write semantics: between any two observations of the
      // file from outside the kernel, the contents should always be
      // a fully-formed JSON document. We can't easily inject a crash
      // mid-write, but we CAN verify that after every setAgentCwd
      // the on-disk file parses and contains the expected entry.
      for (let i = 0; i < 5; i++) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), `concurrent-${i}-`));
        await setAgentCwd("claude-code", dir);
        const raw = await fs.readFile(tmpFile, "utf8");
        const parsed = JSON.parse(raw);
        expect(parsed["claude-code"]).toBe(dir);
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("serialises concurrent writes — both updates land", async () => {
      // Without the write-chain, two concurrent setAgentCwd calls
      // could each readMap() before the other writeMap()d, then
      // overwrite each other's update. With the chain, both land.
      const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "concur-a-"));
      const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "concur-b-"));
      try {
        await Promise.all([
          setAgentCwd("alpha", dirA),
          setAgentCwd("beta", dirB),
        ]);
        const raw = await fs.readFile(tmpFile, "utf8");
        const parsed = JSON.parse(raw);
        expect(parsed["alpha"]).toBe(dirA);
        expect(parsed["beta"]).toBe(dirB);
      } finally {
        await fs.rm(dirA, { recursive: true, force: true });
        await fs.rm(dirB, { recursive: true, force: true });
      }
    });

    it("does not leave .tmp- sibling files in the config dir after success", async () => {
      await setAgentCwd("claude-code", tmpDir);
      const entries = await fs.readdir(path.dirname(tmpFile));
      const leftovers = entries.filter((e) => e.includes(".tmp-"));
      expect(leftovers).toEqual([]);
    });
  });

  describe("clearAgentCwd", () => {
    it("removes the entry so getAgentCwd reverts to default (or undefined)", async () => {
      await setAgentCwd("claude-code", tmpDir);
      expect(await getAgentCwd("claude-code")).toBe(tmpDir);
      await clearAgentCwd("claude-code");
      const after = await getAgentCwd("claude-code");
      // Claude has a default — should be ~/Documents-or-$HOME, not the persisted value.
      expect(after).not.toBe(tmpDir);
      expect(after).toBeDefined();
    });

    it("for a non-defaulted agent, clear reverts to undefined", async () => {
      await setAgentCwd("hermes", tmpDir);
      expect(await getAgentCwd("hermes")).toBe(tmpDir);
      await clearAgentCwd("hermes");
      expect(await getAgentCwd("hermes")).toBeUndefined();
    });

    it("is a no-op when the entry doesn't exist", async () => {
      await expect(clearAgentCwd("ghost")).resolves.toBeUndefined();
    });
  });

  describe("snapshotAgentCwd", () => {
    it("reports defaultCwd as the configured per-agent default when no entry exists (claude-code)", async () => {
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.agent).toBe("claude-code");
      expect(snap.persisted).toBe(false);
      expect(snap.cwd).toBeDefined();
      expect(snap.defaultCwd).toBeDefined();
      expect(snap.cwd).toBe(snap.defaultCwd);
    });

    it("reports defaultCwd as null for agents with no configured default (hermes)", async () => {
      const snap = await snapshotAgentCwd("hermes");
      expect(snap.persisted).toBe(false);
      expect(snap.cwd).toBeNull();
      expect(snap.defaultCwd).toBeNull();
    });

    it("reports persisted=true + persisted cwd when entry is valid", async () => {
      await setAgentCwd("claude-code", tmpDir);
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.persisted).toBe(true);
      expect(snap.cwd).toBe(tmpDir);
      // defaultCwd is still reported alongside so the UI can show
      // "Use default (~/Documents)".
      expect(snap.defaultCwd).toBeDefined();
    });

    it("reports persisted=false when stored path no longer exists, falls back to default", async () => {
      const ghost = path.join(tmpDir, "missing");
      await fs.writeFile(tmpFile, JSON.stringify({ "claude-code": ghost }), "utf8");
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.persisted).toBe(false);
      expect(snap.cwd).toBe(snap.defaultCwd);
    });
  });

  describe("isolation from chatStore", () => {
    // Pins the structural invariant: chatStore.newSession only touches
    // chat history + sessionUsage; it must NOT clear the per-agent
    // working-directory persistence.
    it("chatStore.newSession leaves the persisted agent cwd untouched", async () => {
      await setAgentCwd("claude-code", tmpDir);
      expect(await getAgentCwd("claude-code")).toBe(tmpDir);

      chatStore.appendUserMessage("claude-code", "prompt");
      chatStore.appendAssistantMessage("claude-code", {
        role: "assistant",
        text: "x",
        ts: Date.now(),
        usage: { model: "claude-opus-4-7", inputTokens: 1, outputTokens: 1 },
      });
      chatStore.newSession("claude-code");

      expect(await getAgentCwd("claude-code")).toBe(tmpDir);
      const snap = await snapshotAgentCwd("claude-code");
      expect(snap.persisted).toBe(true);
      expect(snap.cwd).toBe(tmpDir);
    });
  });
});
