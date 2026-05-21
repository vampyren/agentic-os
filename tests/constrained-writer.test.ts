import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeMissionNote,
  ConstrainedWriteError,
  type WriteMissionNoteInput,
} from "../src/vault/constrainedWriter";

// A fresh tmp dir per test doubles as the vault root. The inbox
// scaffold (00_Inbox/agentic-os) is created; the allowlisted output
// folders are created lazily by the writer.
let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cw-test-"));
  await fs.mkdir(path.join(vaultRoot, "00_Inbox", "agentic-os"), {
    recursive: true,
  });
});

afterEach(async () => {
  await fs.rm(vaultRoot, { recursive: true, force: true });
});

function input(overrides: Partial<WriteMissionNoteInput> = {}): WriteMissionNoteInput {
  return {
    vaultRoot,
    missionId: "test-mission",
    outputFolder: "00_Inbox/agentic-os/summaries",
    filenameHint: "test-note",
    content: "# Test\n\nbody",
    conflictPolicy: "suffix",
    ...overrides,
  };
}

describe("writeMissionNote — allowed writes", () => {
  it("writes into an allowlisted output root", async () => {
    const r = await writeMissionNote(input());
    expect(r.relativePath.startsWith("00_Inbox/agentic-os/summaries/")).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
    const text = await fs.readFile(path.join(vaultRoot, r.relativePath), "utf8");
    expect(text).toContain("mission: test-mission");
    expect(text).toContain("body");
  });

  it("writes into a nested folder under an allowed root", async () => {
    const r = await writeMissionNote(
      input({ outputFolder: "00_Inbox/agentic-os/missions/sub" }),
    );
    expect(r.relativePath.startsWith("00_Inbox/agentic-os/missions/sub/")).toBe(true);
  });

  it("suffixes on a filename collision", async () => {
    const a = await writeMissionNote(input({ filenameHint: "dup" }));
    const b = await writeMissionNote(input({ filenameHint: "dup" }));
    expect(a.relativePath).not.toBe(b.relativePath);
    expect(b.relativePath).toMatch(/-02\.md$/);
  });

  it("the fail conflict policy rejects an existing note", async () => {
    await writeMissionNote(input({ filenameHint: "once", conflictPolicy: "fail" }));
    await expect(
      writeMissionNote(input({ filenameHint: "once", conflictPolicy: "fail" })),
    ).rejects.toThrow(ConstrainedWriteError);
  });
});

describe("writeMissionNote — path-traversal rejection", () => {
  it("rejects a .. traversal segment", async () => {
    await expect(
      writeMissionNote(input({ outputFolder: "00_Inbox/agentic-os/../../etc" })),
    ).rejects.toThrow(ConstrainedWriteError);
  });

  it("rejects an encoded .. traversal after URL-decode", async () => {
    await expect(
      writeMissionNote(
        input({ outputFolder: "00_Inbox/agentic-os/summaries/%2e%2e/%2e%2e/etc" }),
      ),
    ).rejects.toThrow(ConstrainedWriteError);
  });

  it("rejects an absolute / leading-slash outputFolder", async () => {
    await expect(
      writeMissionNote(input({ outputFolder: "/etc" })),
    ).rejects.toThrow(ConstrainedWriteError);
  });

  it("rejects a folder outside the mission-output allowlist", async () => {
    await expect(
      writeMissionNote(input({ outputFolder: "00_Inbox/agentic-os/secrets" })),
    ).rejects.toThrow(ConstrainedWriteError);
  });

  it("rejects a filename hint with a path separator", async () => {
    await expect(
      writeMissionNote(input({ filenameHint: "../escape" })),
    ).rejects.toThrow(ConstrainedWriteError);
  });

  it("rejects a malformed percent-escape in the output folder", async () => {
    await expect(
      writeMissionNote(input({ outputFolder: "00_Inbox/agentic-os/summaries/%ZZ" })),
    ).rejects.toThrow(ConstrainedWriteError);
  });
});

describe("writeMissionNote — symlink-escape rejection", () => {
  it("refuses to write through a symlinked folder that escapes the vault", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cw-evil-"));
    try {
      // Replace the summaries folder with a symlink pointing outside.
      const summaries = path.join(vaultRoot, "00_Inbox", "agentic-os", "summaries");
      await fs.symlink(outside, summaries);
      await expect(
        writeMissionNote(input({ outputFolder: "00_Inbox/agentic-os/summaries" })),
      ).rejects.toThrow(ConstrainedWriteError);
      // Nothing leaked into the symlink target.
      const leaked = await fs.readdir(outside);
      expect(leaked).toHaveLength(0);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects when the inbox boundary itself is a symlink escaping the vault", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cw-evil-"));
    try {
      // Replace 00_Inbox/agentic-os with a symlink pointing outside.
      const inbox = path.join(vaultRoot, "00_Inbox", "agentic-os");
      await fs.rm(inbox, { recursive: true, force: true });
      await fs.symlink(outside, inbox);
      await expect(writeMissionNote(input())).rejects.toThrow(ConstrainedWriteError);
      expect(await fs.readdir(outside)).toHaveLength(0);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("does not create directories outside the vault via a symlinked allowed parent", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cw-evil-"));
    try {
      // summaries is a symlink outside; outputFolder nests under it.
      const summaries = path.join(vaultRoot, "00_Inbox", "agentic-os", "summaries");
      await fs.symlink(outside, summaries);
      await expect(
        writeMissionNote(
          input({ outputFolder: "00_Inbox/agentic-os/summaries/nested" }),
        ),
      ).rejects.toThrow(ConstrainedWriteError);
      // The nested directory was never created inside the symlink target.
      expect(await fs.readdir(outside)).toHaveLength(0);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
