// Vault reader: read note with frontmatter, list inbox notes by subdir.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readNote, listInboxNotes, walkVaultNotes } from "../src/vault/reader";

let vault: string;

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-reader-"));
  // Set up inbox dirs and a couple of notes.
  await fs.mkdir(path.join(vault, "00_Inbox", "agentic-os", "chats"), { recursive: true });
  await fs.mkdir(path.join(vault, "10_Projects"), { recursive: true });
  await fs.writeFile(
    path.join(vault, "00_Inbox", "agentic-os", "chats", "a.md"),
    `---
type: chat
agent: claude-code
created: 2026-05-16
tags:
  - ai
---

# Note A

body of note A
`,
  );
  await fs.writeFile(
    path.join(vault, "00_Inbox", "agentic-os", "chats", "b.md"),
    `---
type: chat
agent: hermes
---

# Note B

body of note B
`,
  );
  await fs.writeFile(
    path.join(vault, "10_Projects", "project1.md"),
    `# Project 1\n\noutside the inbox`,
  );
});

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe("vault reader", () => {
  it("reads a note's frontmatter and body", async () => {
    const note = await readNote(vault, "00_Inbox/agentic-os/chats/a.md");
    expect(note).not.toBeNull();
    expect(note!.frontmatter["type"]).toBe("chat");
    expect(note!.frontmatter["agent"]).toBe("claude-code");
    expect(note!.body).toContain("body of note A");
  });

  it("lists inbox notes for a subdir, newest-first", async () => {
    // Touch b.md so it has a more recent mtime.
    await new Promise((r) => setTimeout(r, 20));
    await fs.utimes(
      path.join(vault, "00_Inbox", "agentic-os", "chats", "b.md"),
      new Date(),
      new Date(),
    );
    const list = await listInboxNotes(vault, "chats");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatch(/b\.md$/);
    expect(list[1]).toMatch(/a\.md$/);
  });

  it("returns null for paths outside the vault root", async () => {
    await expect(readNote(vault, "../../../etc/passwd")).rejects.toThrow(/outside/);
  });

  it("walkVaultNotes yields every .md across the whole vault", async () => {
    const collected: string[] = [];
    for await (const rel of walkVaultNotes(vault)) collected.push(rel);
    expect(collected.sort()).toEqual([
      "00_Inbox/agentic-os/chats/a.md",
      "00_Inbox/agentic-os/chats/b.md",
      "10_Projects/project1.md",
    ]);
  });
});
