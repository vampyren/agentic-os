// Icon registry — registry-driven shell (Phase 1C — M2).
//
// A feature's `NavExposure.iconKey` crosses the UI-safe projection as a
// plain string (the projection cannot ship a React component). The
// shell turns that string back into an icon ONLY through this CLOSED
// allowlist — never via a dynamic `import()` or by indexing an open
// object with caller-supplied text. An unrecognised key resolves to a
// neutral fallback, so a typo or a removed icon can never crash a
// render or pull in an unexpected module.

import { Circle, Clock, CalendarClock, type LucideIcon } from "lucide-react";

// Add an entry here when a feature declares a new `iconKey`. Keys are
// kebab-case and stable — they are part of the exposure contract.
const ICONS: Record<string, LucideIcon> = {
  clock: Clock,
  "calendar-clock": CalendarClock,
};

// Membership via a key Set built from own-enumerable keys only — a
// plain `key in ICONS` would also match `Object.prototype` members
// (e.g. "toString"), which must NOT count as registered icons.
const ICON_KEYS = new Set(Object.keys(ICONS));

/** Shown when an `iconKey` is absent from the allowlist. */
const FALLBACK_ICON: LucideIcon = Circle;

/** Resolve an `iconKey` to a lucide icon; unknown keys → fallback. */
export function iconFor(key: string): LucideIcon {
  return ICONS[key] ?? FALLBACK_ICON;
}

/** Whether `key` is a registered icon (drives selector filtering). */
export function hasIcon(key: string): boolean {
  return ICON_KEYS.has(key);
}
