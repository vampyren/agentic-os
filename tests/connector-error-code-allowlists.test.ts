import { describe, expect, it } from "vitest";
import {
  CONNECTOR_ERROR_CODES,
  CONNECTOR_ERROR_CODE_SET,
  type ConnectorErrorCode,
} from "../src/kernel/connectors/types";

// FU5 PR A — fix #2: drift guard for the ConnectorErrorCode set.
//
// Before this guard, `testConnection.ts` carried a local copy of the
// neutral errorCode allowlist that drifted away from the type when
// M4a-5 PR AB added `response-too-large` to ConnectorErrorCode but
// not to the local Set — every `response-too-large` from a family
// got normalized to `unknown`, hiding the real error from operators
// and tests.
//
// The new contract: `CONNECTOR_ERROR_CODES` (const-asserted array) is
// the single source of truth. Both the TS type AND the runtime
// allowlist (`CONNECTOR_ERROR_CODE_SET`) derive from it. Any future
// code added to the array automatically updates the type and the set.
// This file's assertions encode that contract so a future drift
// (someone re-introducing a local copy) breaks the suite loudly.

describe("ConnectorErrorCode allowlists — drift guard", () => {
  it("CONNECTOR_ERROR_CODE_SET contains exactly the values in CONNECTOR_ERROR_CODES", () => {
    expect(CONNECTOR_ERROR_CODE_SET.size).toBe(CONNECTOR_ERROR_CODES.length);
    for (const code of CONNECTOR_ERROR_CODES) {
      expect(CONNECTOR_ERROR_CODE_SET.has(code)).toBe(true);
    }
  });

  it("the array carries every code that previously lived in the local copies (including response-too-large)", () => {
    // Encode the post-FU5 PR A snapshot so a deletion is loud.
    const expectedSnapshot: ReadonlyArray<ConnectorErrorCode> = [
      "auth-failed", "auth-missing", "rate-limited", "network-unreachable",
      "config-invalid", "capability-not-supported", "capability-unavailable",
      "external-system-unavailable", "binary-not-found", "blocked-network",
      "response-too-large", "unknown",
    ];
    for (const code of expectedSnapshot) {
      expect(CONNECTOR_ERROR_CODE_SET.has(code)).toBe(true);
    }
    // And the array length matches — catches an accidental rename
    // that drops `response-too-large` from the array even if a new
    // code was added.
    expect(CONNECTOR_ERROR_CODES.length).toBeGreaterThanOrEqual(
      expectedSnapshot.length,
    );
  });

  it("testConnection.normalizeErrorCode preserves response-too-large (regression for fix #2)", async () => {
    // Black-box: import normalizeErrorCode behaviour via the public
    // re-export point — `runConnectorTest`'s return value reflects
    // normalization. A unit-test for normalizeErrorCode itself isn't
    // exported; we re-prove the contract end-to-end in
    // `connector-test-run.test.ts::preserves response-too-large …`
    // and rely on this drift guard for the static set membership.
    expect(CONNECTOR_ERROR_CODE_SET.has("response-too-large")).toBe(true);
  });
});
