// Build a throwaway vault + config so the dev server can boot without
// depending on the operator's real ~/.agentic-os/ — this lets the Playwright
// suite run on CI runners that have no Obsidian vault and no claude/hermes
// CLIs installed.
//
// We use a deterministic path under /tmp so playwright.config.ts can hardcode
// the same value in its webServer.env block without timing coupling between
// globalSetup and the webServer subprocess launch.

import { promises as fs } from "node:fs";
import path from "node:path";
import { TMP_ROOT } from "./e2e-paths";

export default async function globalSetup(): Promise<void> {
  const vault = path.join(TMP_ROOT, "vault");
  const configPath = path.join(TMP_ROOT, "config.yaml");

  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(vault, "00_Inbox", "agentic-os"), { recursive: true });
  await fs.writeFile(
    configPath,
    `vault:\n  root: ${vault}\nagents:\n  default: claude-code\n`,
    "utf8",
  );
}
