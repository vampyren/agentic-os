// Build a throwaway vault + config so the dev server can boot without
// depending on the operator's real ~/.agentic-os/ — this lets the Playwright
// suite run on CI runners that have no Obsidian vault and no claude/hermes
// CLIs installed.
//
// We use a deterministic path under /tmp so playwright.config.ts can hardcode
// the same value in its webServer.env block without timing coupling between
// globalSetup and the webServer subprocess launch.
//
// Defense-in-depth: assert TMP_ROOT actually resolves under os.tmpdir()
// before doing any rm-rf. Cheap and prevents a misconfigured TMP_ROOT
// (set to something operator-private by accident) from being destroyed.
// Paired with `reuseExistingServer: false` in playwright.config.ts which
// is the real fix for the v0.2.11 real-vault-pollution bug.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TMP_ROOT } from "./e2e-paths";

export default async function globalSetup(): Promise<void> {
  const vault = path.join(TMP_ROOT, "vault");
  const configPath = path.join(TMP_ROOT, "config.yaml");

  // Assert: TMP_ROOT must live under the OS tmpdir. Refuse to operate
  // anywhere else — e.g. if someone hardcoded /home/spawn/... by mistake.
  const tmpResolved = path.resolve(os.tmpdir());
  const rootResolved = path.resolve(TMP_ROOT);
  if (rootResolved !== tmpResolved && !rootResolved.startsWith(tmpResolved + path.sep)) {
    throw new Error(
      `e2e globalSetup refusing to operate on ${rootResolved}: ` +
      `must be inside ${tmpResolved} (os.tmpdir()). Check e2e/e2e-paths.ts.`,
    );
  }

  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(vault, "00_Inbox", "agentic-os"), { recursive: true });
  await fs.writeFile(
    configPath,
    `vault:\n  root: ${vault}\nagents:\n  default: claude-code\n`,
    "utf8",
  );
}
