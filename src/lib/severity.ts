// Conservative severity scanner for already-cleaned action output. Used
// by the Control Room viewer (Slice 5) to surface a small advisory pill
// when stdout/stderr looks like it carries a problem signal — e.g.
// `hermes status` showing "DEGRADED", or `hermes doctor` reporting
// "ERROR: missing dependency".
//
// Hard rules baked in by design:
//   - Uppercase + word-boundary only. A model output sentence like "we
//     issued a warning about ..." MUST NOT trip the scanner. Status
//     dumps from CLIs reliably print uppercase WARN/ERROR tokens, so
//     this catches the real signal and drops the prose noise.
//   - `err` outranks `warn`. If both keywords appear in one chunk, the
//     more serious tone wins.
//   - Pure function, no I/O, no globals. Cheap enough to run per render.
//
// FAIL-SOFT CONTRACT: this helper must never throw — and even if a
// caller passes something weird, returning `null` is the safe default.
// The Control Room wraps its call in `try { ... } catch { return null }`
// as defense in depth, so a parser regression can never fail an action.

export type Severity = "warn" | "err" | null;

const WARN_RE = /\b(?:WARN(?:ING)?|DEGRADED|DEPRECATED|UNHEALTHY)\b/;
const ERR_RE = /\b(?:ERROR|CRITICAL|FATAL|FAIL(?:ED|URE)?|PANIC|OFFLINE)\b/;

export function detectSeverity(text: string | undefined | null): Severity {
  if (!text || typeof text !== "string") return null;
  if (ERR_RE.test(text)) return "err";
  if (WARN_RE.test(text)) return "warn";
  return null;
}
