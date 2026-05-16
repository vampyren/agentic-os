// Playwright config for Phase 1B smoke tests.
//
// e2e/global-setup.ts builds a throwaway vault + config at a fixed /tmp path
// (TMP_CONFIG / TMP_VAULT in e2e/e2e-paths.ts) so the tests don't depend on
// the operator's real ~/.agentic-os/. The webServer subprocess gets the same
// path via the env block below — no timing coupling between globalSetup
// execution and webServer launch.
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
    reuseExistingServer: !process.env.CI,
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
