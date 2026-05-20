// Vault-relative path validation for mission outputs (Phase 1C — M3).
//
// Missions declare an output folder. The M3 config schema and the
// effective-plan resolver validate that folder LEXICALLY against an
// allowlist of `00_Inbox/agentic-os/...` roots. M3 never touches the
// filesystem — the realpath / symlink-escape check is the M4
// constrained writer's job, at write time.

/** A vault-relative path that has passed the mission-output allowlist. */
export type VaultRelativePath = string & { readonly __brand: "VaultRelativePath" };

/**
 * The folders a mission may write outputs into. Every mission output
 * folder (a mission's `defaultOutputFolder` or a config override) must
 * equal one of these or be nested under it.
 */
export const ALLOWED_MISSION_OUTPUT_ROOTS = [
  "00_Inbox/agentic-os/summaries",
  "00_Inbox/agentic-os/reviews",
  "00_Inbox/agentic-os/missions",
  "00_Inbox/agentic-os/studio",
  "00_Inbox/agentic-os/kanban",
] as const;

/**
 * Lexical check that a path is a safe mission output folder:
 *   - a non-empty string,
 *   - relative (no leading `/`),
 *   - no backslashes,
 *   - no `.` / `..` / empty path segments,
 *   - equal to or nested under one of ALLOWED_MISSION_OUTPUT_ROOTS.
 *
 * This is a string check only — it does not resolve symlinks or hit
 * the filesystem (that is the M4 constrained writer's responsibility).
 */
export function isAllowedMissionOutputFolder(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\\")) return false;
  const norm = p.replace(/\/+$/, "");
  const segments = norm.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  return ALLOWED_MISSION_OUTPUT_ROOTS.some(
    (root) => norm === root || norm.startsWith(root + "/"),
  );
}

/**
 * Validate + brand a vault-relative mission output path. Throws if the
 * path is not an allowed mission output folder. Any trailing slash is
 * trimmed from the branded result.
 */
export function toVaultRelativePath(p: string): VaultRelativePath {
  if (!isAllowedMissionOutputFolder(p)) {
    throw new Error(
      `not an allowed mission output folder: ${JSON.stringify(p)} — ` +
      `must be under one of: ${ALLOWED_MISSION_OUTPUT_ROOTS.join(", ")}`,
    );
  }
  return p.replace(/\/+$/, "") as VaultRelativePath;
}
