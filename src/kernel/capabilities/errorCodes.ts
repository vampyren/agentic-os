// Closed RouterErrorCode union (M4a-5 PR AB, spec §9).
//
// CapabilityInvokeResult.errorCode is the value any code implementing
// CapabilityRouter emits when a dispatch fails — it is the post-sanitization
// surface (ADR-0012 / B13). It is intentionally a CLOSED neutral set,
// disjoint from the per-connector ConnectorErrorCode union: a connector
// cannot widen the router contract by returning an arbitrary string.
//
// As of M4a-5 PR AB, CapabilityInvokeResult.errorCode is typed
// `RouterErrorCode | undefined` (the post-tightening type) and there is a
// runtime check `isRouterErrorCode` plus a unit test guard that every
// failure path uses a member of this set.
//
// Members:
//
//   - "connector-returned-failure" — the family's invoke() returned
//     status: "failed". The router collapses the family's own errorCode
//     to this neutral value (B13).
//   - "connector-invoke-threw"     — the family's invoke() threw. The
//     thrown value is dropped.
//   - "config-invalid"             — the resolved instance failed family
//     settingsSchema or buildConnectorContext.
//   - "connector-unknown"          — no enabled instance matches the
//     requested connectorId (or the id is missing entirely).
//   - "permission-denied"          — the mission-runner's pre-router
//     gating adapter (src/features/scheduler/missions/runner.ts) refused
//     a capability invoke because the mission lacks the relevant
//     permission. Emitted BEFORE the real router is reached but the
//     adapter implements CapabilityRouter, so the error is part of the
//     router contract surface.

export type RouterErrorCode =
  | "connector-returned-failure"
  | "connector-invoke-threw"
  | "config-invalid"
  | "connector-unknown"
  | "permission-denied";

export const ROUTER_ERROR_CODES: ReadonlySet<RouterErrorCode> = new Set<
  RouterErrorCode
>([
  "connector-returned-failure",
  "connector-invoke-threw",
  "config-invalid",
  "connector-unknown",
  "permission-denied",
]);

export function isRouterErrorCode(x: unknown): x is RouterErrorCode {
  return typeof x === "string" && ROUTER_ERROR_CODES.has(x as RouterErrorCode);
}
