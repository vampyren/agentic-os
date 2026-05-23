// Closed RouterErrorCode union (M4a-5 PR AB, spec §9).
//
// CapabilityInvokeResult.errorCode is the value the capability ROUTER emits
// when a dispatch fails — it is the post-sanitization surface (ADR-0012 /
// B13). It is intentionally a CLOSED neutral set, disjoint from the
// per-connector ConnectorErrorCode union: a connector cannot widen the
// router contract by returning an arbitrary string.
//
// CapabilityInvokeResult.errorCode is typed `string | undefined` in M4a
// (back-compat); the type tightening to `RouterErrorCode | undefined`
// follows the next pass after every caller is reviewed. For now, every
// router error path emits a value from `ROUTER_ERROR_CODES` and a unit
// test asserts that property.

export type RouterErrorCode =
  | "connector-returned-failure"
  | "connector-invoke-threw"
  | "config-invalid"
  | "connector-unknown";

export const ROUTER_ERROR_CODES: ReadonlySet<RouterErrorCode> = new Set<
  RouterErrorCode
>([
  "connector-returned-failure",
  "connector-invoke-threw",
  "config-invalid",
  "connector-unknown",
]);

export function isRouterErrorCode(x: unknown): x is RouterErrorCode {
  return typeof x === "string" && ROUTER_ERROR_CODES.has(x as RouterErrorCode);
}
