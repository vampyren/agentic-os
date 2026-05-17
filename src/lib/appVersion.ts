// Single source of truth for the app version displayed in the UI.
//
// Why a dedicated module:
// - `package.json` is the canonical version (release-hygiene test
//   already enforces the other surfaces match this).
// - The sidebar previously hardcoded `v0.2.11 · ⌘K` as a string literal.
//   That meant a release bump could ship if the developer forgot to
//   update the badge — only the release-hygiene vitest test would catch
//   it, and the operator-facing UI would lie until then.
// - This module derives the badge from `package.json` so a `package.json`
//   bump propagates everywhere automatically; the hygiene test now
//   asserts that no raw `vX.Y.Z · ⌘K` literal remains in Sidebar.tsx
//   (i.e. the sidebar can't drift back to a hardcoded string).
//
// `resolveJsonModule: true` in `tsconfig.json` makes this import legal.
// Next bundles the relevant property into the client bundle at build
// time; it does NOT ship the rest of package.json.

import pkg from "../../package.json";

/** Bare semver string from `package.json`, e.g. "0.2.11". */
export const APP_VERSION: string = pkg.version;

/** UI-display form, e.g. "v0.2.11". */
export const APP_VERSION_LABEL: string = `v${pkg.version}`;
