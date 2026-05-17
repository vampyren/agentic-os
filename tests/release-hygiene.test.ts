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

  it("appVersion lib derives APP_VERSION + APP_VERSION_LABEL from package.json", async () => {
    // Single source of truth: src/lib/appVersion.ts imports package.json and
    // re-exports `APP_VERSION` (semver) + `APP_VERSION_LABEL` ("v" + semver).
    // The whole UI version display flows through this module so a bump to
    // package.json automatically updates everything that displays a version.
    const pkg = await readJson<Pkg>("package.json");
    const lib = await import("../src/lib/appVersion");
    expect(lib.APP_VERSION).toBe(pkg.version);
    expect(lib.APP_VERSION_LABEL).toBe(`v${pkg.version}`);
  });

  it("Sidebar.tsx renders the version via APP_VERSION_LABEL, not a hardcoded literal", async () => {
    // Lesson from the v0.2.11 review: the sidebar badge was a string literal
    // (`v0.2.11 · ⌘K`) that had to be hand-bumped every release. If forgotten,
    // only this test caught the drift after the fact. The new contract: the
    // sidebar MUST import APP_VERSION_LABEL and MUST NOT contain a raw
    // `v\d+\.\d+\.\d+ · ⌘K` literal anywhere in the file.
    const sidebar = await fs.readFile(path.join(REPO_ROOT, "src/components/Sidebar.tsx"), "utf8");
    expect(
      sidebar,
      "Sidebar.tsx must import { APP_VERSION_LABEL } from '@/lib/appVersion'",
    ).toMatch(/import\s*\{\s*APP_VERSION_LABEL\s*\}\s*from\s*["']@\/lib\/appVersion["']/);
    expect(
      sidebar,
      "Sidebar.tsx must render {APP_VERSION_LABEL} (not a hardcoded version string)",
    ).toMatch(/\{\s*APP_VERSION_LABEL\s*\}/);
    // Explicit anti-regression: no `vX.Y.Z · ⌘K` literal allowed.
    expect(
      sidebar.match(/v\d+\.\d+\.\d+\s*·\s*⌘K/),
      "Sidebar.tsx must not contain a hardcoded `vX.Y.Z · ⌘K` literal — use APP_VERSION_LABEL",
    ).toBeNull();
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
