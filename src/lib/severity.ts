// Conservative severity scanner for already-cleaned action output. Used
// by the Control Room viewer (Slice 5) to surface a small advisory pill
// when stdout/stderr looks like it carries a problem signal — e.g.
// `hermes status` showing "DEGRADED", or `hermes doctor` reporting
// "ERROR: missing dependency".
//
// Hard rules baked in by design:
//   - Uppercase + word-boundary signal detection. A model output sentence
//     like "we issued a warning about ..." MUST NOT trip the scanner.
//     Status dumps from CLIs reliably print uppercase WARN/ERROR tokens,
//     so this catches the real signal and drops prose noise.
//   - Line-by-line scanning. A clean summary line like "0 WARNINGS" must
//     not hide a real "ERROR: missing dependency" on a later line.
//   - Negated/count summary lines are ignored. Examples:
//     "0 ERRORS", "NO WARNINGS", "ERRORS: 0", "FAILURES: NONE".
//   - `err` outranks `warn`.
//   - Pure function, no I/O, no globals. Cheap enough to run per render.
//
// FAIL-SOFT CONTRACT: this helper must never throw. If the caller passes
// something weird, returning `null` is the safe default.

export type Severity = "warn" | "err" | null;

const WARN_RE = /\b(?:WARN(?:ING)?|DEGRADED|DEPRECATED|UNHEALTHY)\b/;
const ERR_RE = /\b(?:ERROR|CRITICAL|FATAL|FAIL(?:ED|URE)?|PANIC|OFFLINE)\b/;

// Lines that NAME a severity word but report its ABSENCE — normal output,
// not a problem signal. Case-insensitive on purpose: this regex only ever
// SUPPRESSES a match, so being lenient here cannot create a false positive.
// Examples:
//   "0 ERRORS"
//   "no errors found"
//   "ZERO WARNINGS"
//   "ERRORS: 0"
//   "ERROR = none"
//   "FAILURES: NONE"
//   "warnings: 0"
const NEGATED_RE =
  /\b(?:no|0|zero)\s+\w*(?:error|warn|fail|critical|fatal|panic|degraded|unhealthy)\w*\b|\b\w*(?:error|warn|fail|critical|fatal|panic|degraded|unhealthy)\w*\s*[:=]+\s*(?:0|none|null|ok|false)\b/i;

export function detectSeverity(text: string | undefined | null): Severity {
  if (!text || typeof text !== "string") return null;

  let warn = false;

  for (const line of text.split("\n")) {
    if (NEGATED_RE.test(line)) continue;

    if (ERR_RE.test(line)) return "err";
    if (WARN_RE.test(line)) warn = true;
  }

  return warn ? "warn" : null;
}
