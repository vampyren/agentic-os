// Vault FTS5 index: build from fixture notes, search returns expected hits,
// detects changes, removes deleted files.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { VaultIndex } from "../src/kernel/vaultIndex";

let vault: string;
let dbPath: string;

async function writeNote(rel: string, frontmatter: Record<string, unknown>, body: string) {
  const full = path.join(vault, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  await fs.writeFile(full, `---\n${yaml}\n---\n\n# ${frontmatter["title"] ?? rel}\n\n${body}\n`);
}

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-idx-"));
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-idxdb-"));
  dbPath = path.join(dbDir, "index.db");
});

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
  await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
});

describe("vault FTS5 index", () => {
  it("scans, indexes, and returns matching results with snippets", async () => {
    await writeNote("notes/agentic-design.md",
      { type: "research", agent: "operator", title: "Agentic design notes" },
      "The OS uses a Transport interface to decouple agent CLIs from the kernel.",
    );
    await writeNote("notes/vacation.md",
      { type: "research", agent: "operator", title: "Vacation plans" },
      "A weekend in the mountains away from any computer or wifi.",
    );

    const idx = new VaultIndex({ dbPath, vaultRoot: vault });
    const scan = await idx.fullScan();
    expect(scan.indexed).toBe(2);
    expect(idx.count()).toBe(2);

    const hits = idx.search("transport");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.path).toBe("notes/agentic-design.md");
    expect(hits[0]!.snippet.toLowerCase()).toContain("«transport»");
    expect(hits[0]!.type).toBe("research");

    idx.close();
  });

  it("updates the index when a note changes (re-scan with newer mtime)", async () => {
    await writeNote("a.md", { type: "research" }, "alpha bravo charlie");

    const idx = new VaultIndex({ dbPath, vaultRoot: vault });
    await idx.fullScan();
    expect(idx.search("bravo")).toHaveLength(1);
    expect(idx.search("delta")).toHaveLength(0);

    // Edit and bump mtime forward.
    await new Promise((r) => setTimeout(r, 20));
    await writeNote("a.md", { type: "research" }, "delta echo foxtrot");

    const second = await (async () => {
      const idx2 = new VaultIndex({ dbPath, vaultRoot: vault });
      return await idx2.fullScan();
    })();
    expect(second.indexed).toBe(1);     // re-indexed because mtime changed

    const idx3 = new VaultIndex({ dbPath, vaultRoot: vault });
    expect(idx3.search("delta")).toHaveLength(1);
    expect(idx3.search("bravo")).toHaveLength(0);
    idx3.close();
  });

  it("drops removed files from the index on next full scan", async () => {
    await writeNote("a.md", { type: "research" }, "first");
    await writeNote("b.md", { type: "research" }, "second");
    const idx = new VaultIndex({ dbPath, vaultRoot: vault });
    await idx.fullScan();
    expect(idx.count()).toBe(2);

    await fs.unlink(path.join(vault, "a.md"));
    const idx2 = new VaultIndex({ dbPath, vaultRoot: vault });
    await idx2.fullScan();
    expect(idx2.count()).toBe(1);
    expect(idx2.search("first")).toHaveLength(0);
    idx2.close();
  });

  it("returns empty results for empty queries instead of throwing", async () => {
    const idx = new VaultIndex({ dbPath, vaultRoot: vault });
    expect(idx.search("")).toEqual([]);
    expect(idx.search("   ")).toEqual([]);
    idx.close();
  });
});
