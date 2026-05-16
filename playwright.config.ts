// Playwright config for Phase 1B smoke tests.
//
// e2e/global-setup.ts builds a throwaway vault + config in /tmp so the tests
// don't depend on the operator's real ~/.agentic-os/ — they only verify the
// dashboard renders, the agents list endpoint responds, and basic routes
// don't throw. Agent invocations against real CLIs are NOT exercised here
// (covered by manual smoke; CI runners don't have claude/hermes installed).

import { defineConfig } from "@playwright/test";

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
    // No explicit env override here on purpose — Playwright's webServer
    // inherits the parent process env, and global-setup.ts populates
    // AGENTIC_OS_CONFIG / AGENTIC_OS_VAULT before the server boots. Listing
    // them explicitly in this block would snapshot the values at module-
    // load time (before globalSetup runs) and produce empty strings.
  },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
