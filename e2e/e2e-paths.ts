// Shared paths between playwright.config.ts and e2e/global-setup.ts so both
// agree on where the throwaway vault + config live during test runs.

import path from "node:path";
import os from "node:os";

export const TMP_ROOT = path.join(os.tmpdir(), "agentic-e2e");
export const TMP_CONFIG = path.join(TMP_ROOT, "config.yaml");
export const TMP_VAULT = path.join(TMP_ROOT, "vault");
