// Playwright config for Phase 1B smoke tests.
//
// e2e/global-setup.ts builds a throwaway vault + config at a fixed /tmp path
// (TMP_CONFIG / TMP_VAULT in e2e/e2e-paths.ts) so the tests don't depend on
// the operator's real ~/.agentic-os/. The webServer subprocess gets the same
// path via the env block below — no timing coupling between globalSetup
// execution and webServer launch.
//
// `reuseExistingServer: false` is load-bearing: in dev mode (no CI env),
// Playwright would otherwise REUSE any already-running `next dev` server
// AND skip applying the env block below. If that pre-existing server was
// started against the operator's real ~/.agentic-os/config.yaml (no
// AGENTIC_OS_VAULT override), goal/journal POSTs from the e2e suite would
// land in the operator's REAL Obsidian vault. Rex hit exactly this bug
// during the v0.2.11 review (smoke files left in the real vault). The
// extra ~10s of test startup is the cost of vault isolation.
//
// CI runners don't have claude/hermes installed, so we only verify the
// dashboard renders, /api/agents responds, and goal/journal POSTs land.
// Agent invocations against real CLIs are covered by manual smoke.

import { defineConfig } from "@playwright/test";
import { TMP_CONFIG, TMP_VAULT } from "./e2e/e2e-paths";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      AGENTIC_OS_CONFIG: TMP_CONFIG,
      AGENTIC_OS_VAULT: TMP_VAULT,
    },
  },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
