// Extract a compact semver-ish version token from an agent's
// `--version` output. Different CLIs print very different first-line
// formats:
//
//   claude-code: "2.1.144 (Claude Code)"        → "2.1.144"
//   hermes:      "Hermes Agent v0.14.0 (2026.5.16)" → "v0.14.0"
//
// A naive `split(" ")[0]` picks "Hermes" for the second case — visually
// useless on a Mission Control card. This helper finds a version-looking
// token anywhere in the string and falls back to the first whitespace-
// separated token if no pattern matches.

const VERSION_RE = /v?\d+\.\d+(?:\.\d+)?(?:\.\d+)?/;

/**
 * Returns a short, display-friendly version token, or `placeholder`
 * (default "—") when no value can be extracted. The input may be the
 * raw first line of `--version` stdout (multi-word, parenthesised
 * metadata, etc.).
 */
export function extractVersion(raw: string | undefined | null, placeholder = "—"): string {
  if (!raw) return placeholder;
  const trimmed = raw.trim();
  if (!trimmed) return placeholder;
  const m = trimmed.match(VERSION_RE);
  if (m && m[0]) return m[0];
  // Fall back to the first whitespace-separated token — handles CLIs
  // that print only a bare version with no extra wording.
  const first = trimmed.split(/\s+/)[0];
  return first || placeholder;
}
