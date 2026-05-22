// authRef resolver (M4a-1, spec §6).
//
// authRef is env-only in M4a: "none" or "env:VAR_NAME". The resolver reads
// process.env server-side and returns the secret ONLY into the resolution
// result, which a connector receives via ConnectorInvokeContext.secret. The
// secret is never logged, never put in a ConnectorResult / ConnectorValidation
// message, never written to the run ledger, audit, an API response, or config.
//
// Server-only module — must not enter a client bundle.

import type { AuthRef } from "./schema";

export type AuthResolution =
  | { ok: true; secret: string }
  | { ok: false; errorCode: "auth-missing" | "auth-malformed" };

const ENV_REF = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;

/** Resolve an authRef to its secret value. Never throws; never leaks. */
export function resolveAuthRef(authRef: AuthRef | undefined): AuthResolution {
  if (!authRef || authRef === "none") {
    return { ok: false, errorCode: "auth-missing" };
  }
  const match = ENV_REF.exec(authRef);
  if (!match) {
    return { ok: false, errorCode: "auth-malformed" };
  }
  const value = process.env[match[1]!];
  if (value === undefined || value.length === 0) {
    return { ok: false, errorCode: "auth-missing" };
  }
  return { ok: true, secret: value };
}
