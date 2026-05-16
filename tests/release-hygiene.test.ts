// Release hygiene: every place that displays or declares the version must
// agree. This test would have caught:
// - v0.2.2 → v0.2.3: sidebar badge stuck on v0.2.1 (caught manually after release)
// - v0.2.3 → v0.2.4: package-lock root version stuck on 0.1.0 (caught by Hermes review)
//
// CI runs this on every push, so version drift fails the build before tag.

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");

async function readJson<T>(rel: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, rel), "utf8")) as T;
}

interface Pkg { version: string; name: string; }
interface Lock {
  version: string;
  packages: Record<string, { version?: string }>;
}

describe("release hygiene — version consistency", () => {
  it("package.json and package-lock.json root version agree", async () => {
    const pkg = await readJson<Pkg>("package.json");
    const lock = await readJson<Lock>("package-lock.json");
    expect(lock.version).toBe(pkg.version);
  });

  it("package-lock.json packages[''] mirrors the root version", async () => {
    const pkg = await readJson<Pkg>("package.json");
    const lock = await readJson<Lock>("package-lock.json");
    const rootPkg = lock.packages[""];
    expect(rootPkg).toBeDefined();
    expect(rootPkg!.version).toBe(pkg.version);
  });

  it("sidebar in-app version badge matches package.json version", async () => {
    const pkg = await readJson<Pkg>("package.json");
    const sidebar = await fs.readFile(path.join(REPO_ROOT, "src/components/Sidebar.tsx"), "utf8");
    // Expect a line like `v0.2.4 · ⌘K` in the sidebar.
    const badgeRegex = /v(\d+\.\d+\.\d+)\s*·\s*⌘K/;
    const match = sidebar.match(badgeRegex);
    expect(match, "sidebar badge must contain `vX.Y.Z · ⌘K`").not.toBeNull();
    expect(match![1]).toBe(pkg.version);
  });

  it("README status line names the current version", async () => {
    const pkg = await readJson<Pkg>("package.json");
    const readme = await fs.readFile(path.join(REPO_ROOT, "README.md"), "utf8");
    // The Status: ... line uses the v-prefix.
    expect(readme).toMatch(new RegExp(`Status:\\s*v${pkg.version.replace(/\./g, "\\.")}\\b`));
  });

  it("CHANGELOG.md has an entry for the current version", async () => {
    const pkg = await readJson<Pkg>("package.json");
    const cl = await fs.readFile(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    const heading = new RegExp(`^##\\s+\\[${pkg.version.replace(/\./g, "\\.")}\\]`, "m");
    expect(cl, "CHANGELOG must have a `## [X.Y.Z]` heading for the current version").toMatch(heading);
  });

  it("docs/INSTALL.md current-version line matches package.json", async () => {
    // Lesson from Hermes review of v0.2.5: INSTALL.md was stuck on v0.2.4
    // because the previous release checklist marked it as conditional. It
    // isn't — the "Current shipped version" line needs bumping every release.
    const pkg = await readJson<Pkg>("package.json");
    const install = await fs.readFile(path.join(REPO_ROOT, "docs/INSTALL.md"), "utf8");
    const re = new RegExp(`Current shipped version:\\s*\\*\\*v${pkg.version.replace(/\./g, "\\.")}\\*\\*`);
    expect(install, "INSTALL.md must declare `Current shipped version: **vX.Y.Z**` matching package.json")
      .toMatch(re);
  });
});
