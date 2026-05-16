// Build a throwaway vault + config so the dev server can boot without
// depending on the operator's real ~/.agentic-os/ — this lets the Playwright
// suite run on CI runners that have no Obsidian vault and no claude/hermes
// CLIs installed.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export default async function globalSetup(): Promise<void> {
  const tmpRoot = path.join(os.tmpdir(), `agentic-e2e-${process.pid}`);
  const vault = path.join(tmpRoot, "vault");
  const configPath = path.join(tmpRoot, "config.yaml");

  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(vault, "00_Inbox", "agentic-os"), { recursive: true });
  await fs.writeFile(
    configPath,
    `vault:\n  root: ${vault}\nagents:\n  default: claude-code\n`,
    "utf8",
  );

  process.env["AGENTIC_OS_CONFIG"] = configPath;
  process.env["AGENTIC_OS_VAULT"] = vault;
}
