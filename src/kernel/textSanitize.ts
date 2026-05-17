// Tiny sanitizers for CLI output we surface in the dashboard. Kept in
// kernel so the action route + any future surface (events log, status
// widgets) can share the same rules. No deps — Node + browser-safe.

// Strip ANSI escape sequences (CSI, SGR, OSC, single-char ESC). Same
// regex used by the `strip-ansi` package; ported here to avoid adding a
// dependency for one small utility.
//
// Why we strip server-side:
// - The browser <pre> doesn't interpret ANSI, so users see literal
//   `\x1b[1m` / `\x1b[0m` artifacts in the viewer.
// - The audit envelope records lengths only (no raw text), so stripping
//   before counting matches what the operator actually saw.
// - CLIs sometimes still color output even when NO_COLOR=1 and
//   FORCE_COLOR=0 are set, e.g. when they detect a TTY-shaped stdio
//   despite our pipe setup.
const ANSI_RE = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*",
    "(?:",
      "(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)",
      "|",
      "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-ntqry=><~])",
    ")",
  ].join(""),
  "g",
);

export function stripAnsi(s: string): string {
  if (!s) return s;
  // Also normalise carriage returns: many CLIs emit "\r\n" on Linux when
  // routed through pipes, and bare "\r" (progress bars) leaves stale
  // characters when rendered to a <pre>. Drop bare "\r" and squash
  // "\r\n" → "\n".
  return s.replace(ANSI_RE, "").replace(/\r\n/g, "\n").replace(/\r/g, "");
}

/**
 * Clamp every line to maxChars. Lines longer than the limit are
 * truncated with a visible marker so the operator knows content was
 * suppressed. The split is on hard `\n` only — wide-format tables
 * usually have one row per line, so this naturally caps each row
 * independently.
 *
 * Why per-line clamp (not whole-text):
 * - A `hermes sessions list` row containing a truncated system-prompt
 *   preview can still be very long. The actually-useful columns sit at
 *   the END of the row (Last Active / Src / ID). A whole-text cap would
 *   hide them entirely.
 * - Per-line keeps the table structure intact. The marker length
 *   includes a count so debug-by-character-arithmetic still works.
 */
export function clampLines(s: string, maxChars: number): string {
  if (!s) return s;
  if (maxChars <= 0) return s;
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > maxChars) {
      const dropped = line.length - maxChars;
      lines[i] = line.slice(0, maxChars) + ` … [+${dropped} chars]`;
    }
  }
  return lines.join("\n");
}
