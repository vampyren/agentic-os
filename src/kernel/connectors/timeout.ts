// effectiveSignal — always-bounded AbortSignal builder (M4a-5 PR AB, spec §7).
//
// Every HTTP connector fetch is required to be bounded. `effectiveSignal`
// combines an optional `ctx.signal` (cancellation from the kernel) with a
// **default timeout** that always applies — a long-running ctx.signal cannot
// mask the default budget. Node ≥20 ships AbortSignal.any + AbortSignal.timeout
// (already required by the project's engines); we use them directly with no
// boolean toggle and no fallback path.
//
// Server-only.

/**
 * Build an AbortSignal that aborts:
 *
 *   - immediately if `ctxSignal` is already aborted, OR
 *   - when `ctxSignal` aborts (if supplied), OR
 *   - when `defaultMs` elapses.
 *
 * Returns ALWAYS a signal — there is no "unbounded" code path. Each fetch
 * picks a sensible `defaultMs` per operation (testConnection: short;
 * chat.generate: longer; listModels: medium).
 *
 * Node ≥20 is required (AbortSignal.any + AbortSignal.timeout). The repo's
 * package.json engines pin this; a guard at module load makes the contract
 * loud.
 */
export function effectiveSignal(
  ctxSignal: AbortSignal | undefined,
  defaultMs: number,
): AbortSignal {
  if (!Number.isFinite(defaultMs) || defaultMs <= 0) {
    throw new TypeError("effectiveSignal: defaultMs must be a positive finite number");
  }
  const timed = AbortSignal.timeout(defaultMs);
  if (!ctxSignal) return timed;
  // AbortSignal.any forwards the first signal that aborts. If ctxSignal is
  // already aborted at call time, AbortSignal.any returns a pre-aborted
  // signal — operator pre-cancellation honoured.
  return AbortSignal.any([ctxSignal, timed]);
}

// Sanity check at module load: AbortSignal.any + AbortSignal.timeout are
// Node-20 platform features. If they aren't here we are running on an
// unsupported runtime; surface the failure now rather than at the first
// failed fetch.
if (typeof AbortSignal.any !== "function" || typeof AbortSignal.timeout !== "function") {
  throw new Error(
    "effectiveSignal: requires Node >=20 (AbortSignal.any + AbortSignal.timeout)",
  );
}
