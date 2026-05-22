// Resolves the on-disk location of the SQLite state DB — the first of
// Agentic OS's four persistence stores (v8 §7.2). Operator default is
// ~/.agentic-os/state.db, alongside config.yaml and the audit/ directory.
//
// The AGENTIC_OS_STATE_DB env override lets tests point at a tmp file —
// mirrors AGENTIC_OS_CONFIG (config.ts) and AGENTIC_OS_AUDIT_DIR (audit.ts).

import path from "node:path";
import os from "node:os";

export function stateDbPath(): string {
  return (
    process.env["AGENTIC_OS_STATE_DB"]
    ?? path.join(os.homedir(), ".agentic-os", "state.db")
  );
}
