import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  fingerprintConnectorConfig,
  type ConnectorFingerprintInput,
} from "../src/kernel/connectors/connectorFingerprint";

// FU5 PR A — `fingerprintConnectorConfig` (spec §4.4).
//
// Locked properties:
//
//   - Deterministic — equivalent configs always produce the same hex.
//   - Irreversible — SHA-256 (we exercise the format, not the
//     irreversibility; SHA-256 is a primitive).
//   - Narrow — only validation-relevant fields are inputs.
//   - authRef identity is HASHED — the raw env var NAME never appears
//     in the canonical input the helper hashes.
//
// Symmetry across the testConnection write path and the GET hydration
// read path lives in PR B's `connector-fingerprint-symmetry.test.ts`.

function baseline(
  o: Partial<ConnectorFingerprintInput> = {},
): ConnectorFingerprintInput {
  return {
    typeFamily: "openai-compatible-llm",
    presetId: "openai",
    settings: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    capabilities: ["chat.generate"],
    allowLocalNetwork: false,
    authRef: "env:OPENAI_API_KEY",
    ...o,
  };
}

describe("fingerprintConnectorConfig — shape", () => {
  it("returns a 64-character lowercase hex string", () => {
    const out = fingerprintConnectorConfig("openai-live", baseline());
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("fingerprintConnectorConfig — determinism", () => {
  it("the same input twice produces the same hex", () => {
    const a = fingerprintConnectorConfig("openai-live", baseline());
    const b = fingerprintConnectorConfig("openai-live", baseline());
    expect(a).toBe(b);
  });

  it("settings key order does not affect the hash (canonical key sort)", () => {
    const a = fingerprintConnectorConfig(
      "openai-live",
      baseline({
        settings: { baseUrl: "https://api.openai.com/v1", model: "m" },
      }),
    );
    const b = fingerprintConnectorConfig(
      "openai-live",
      baseline({
        settings: { model: "m", baseUrl: "https://api.openai.com/v1" },
      }),
    );
    expect(a).toBe(b);
  });

  it("nested settings key order is canonicalised recursively", () => {
    const a = fingerprintConnectorConfig(
      "c",
      baseline({
        settings: {
          nested: { z: 1, a: 2 },
          baseUrl: "https://x",
          model: "m",
        },
      }),
    );
    const b = fingerprintConnectorConfig(
      "c",
      baseline({
        settings: {
          baseUrl: "https://x",
          model: "m",
          nested: { a: 2, z: 1 },
        },
      }),
    );
    expect(a).toBe(b);
  });

  it("arrays in settings preserve order (operator intent)", () => {
    const a = fingerprintConnectorConfig(
      "c",
      baseline({ settings: { tags: ["x", "y"] } }),
    );
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ settings: { tags: ["y", "x"] } }),
    );
    expect(a).not.toBe(b);
  });

  it("capabilities are sorted before hashing (set-shaped, not ordered)", () => {
    const a = fingerprintConnectorConfig(
      "c",
      baseline({ capabilities: ["chat.generate", "vision.analyze"] }),
    );
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ capabilities: ["vision.analyze", "chat.generate"] }),
    );
    expect(a).toBe(b);
  });
});

describe("fingerprintConnectorConfig — per-field independence", () => {
  it("different connectorId -> different hash", () => {
    const a = fingerprintConnectorConfig("c1", baseline());
    const b = fingerprintConnectorConfig("c2", baseline());
    expect(a).not.toBe(b);
  });

  it("different typeFamily -> different hash", () => {
    const a = fingerprintConnectorConfig("c", baseline());
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ typeFamily: "cli-acp-agent" }),
    );
    expect(a).not.toBe(b);
  });

  it("different presetId -> different hash", () => {
    const a = fingerprintConnectorConfig("c", baseline());
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ presetId: "openrouter" }),
    );
    expect(a).not.toBe(b);
  });

  it("presetId null vs string -> different hashes", () => {
    const a = fingerprintConnectorConfig("c", baseline({ presetId: null }));
    const b = fingerprintConnectorConfig("c", baseline({ presetId: "openai" }));
    expect(a).not.toBe(b);
  });

  it("different settings -> different hash (changed baseUrl)", () => {
    const a = fingerprintConnectorConfig("c", baseline());
    const b = fingerprintConnectorConfig(
      "c",
      baseline({
        settings: { baseUrl: "https://different.example/v1", model: "gpt-4o-mini" },
      }),
    );
    expect(a).not.toBe(b);
  });

  it("different settings -> different hash (changed model)", () => {
    const a = fingerprintConnectorConfig("c", baseline());
    const b = fingerprintConnectorConfig(
      "c",
      baseline({
        settings: { baseUrl: "https://api.openai.com/v1", model: "gpt-4-turbo" },
      }),
    );
    expect(a).not.toBe(b);
  });

  it("different capabilities -> different hash", () => {
    const a = fingerprintConnectorConfig("c", baseline());
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ capabilities: ["chat.generate", "vision.analyze"] }),
    );
    expect(a).not.toBe(b);
  });

  it("different allowLocalNetwork -> different hash", () => {
    const a = fingerprintConnectorConfig(
      "c",
      baseline({ allowLocalNetwork: false }),
    );
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ allowLocalNetwork: true }),
    );
    expect(a).not.toBe(b);
  });

  it("different authRef env name -> different hash", () => {
    const a = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: "env:OPENAI_API_KEY" }),
    );
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: "env:OPENROUTER_API_KEY" }),
    );
    expect(a).not.toBe(b);
  });

  it("future secret authRef -> hash differs from env authRef even with same identity", () => {
    // M4a-6b will introduce `secret:<id>`. The fingerprint must
    // distinguish that from an env var that happens to share the id
    // (the `env:` / `secret:` prefix is captured before hashing).
    const a = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: "env:FOO" }),
    );
    const b = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: "secret:FOO" }),
    );
    expect(a).not.toBe(b);
  });
});

describe("fingerprintConnectorConfig — authRef hashing (§4.4 / §9 non-leak)", () => {
  it("'none' authRef maps to literal 'none' in the canonical input", () => {
    // We don't have access to the canonical input directly, so reproduce
    // it: the helper should treat `undefined` and `"none"` the same, and
    // a "real" env authRef should NOT produce the same hash as either.
    const noneFromUndefined = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: undefined }),
    );
    const noneFromLiteral = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: "none" }),
    );
    const realEnv = fingerprintConnectorConfig(
      "c",
      baseline({ authRef: "env:FOO" }),
    );
    expect(noneFromUndefined).toBe(noneFromLiteral);
    expect(noneFromUndefined).not.toBe(realEnv);
  });

  it("the env var NAME never appears in the canonical input the helper hashes", () => {
    // The helper hashes a JSON canonicalisation that includes the authRef
    // identity AS A SHA-256 HASH. Asserting non-recoverability is a
    // marker-string sweep: we hash the same canonical input shape the
    // helper would produce, then assert the env name does NOT appear in
    // that bytes-fed-to-sha256.
    //
    // We can't introspect the helper directly, so we reconstruct the
    // expected canonical form and assert: (a) the helper produces the
    // expected hash given that form, (b) the env var NAME is absent.
    const markerName = "OPENAI_API_KEY";
    const input = baseline({ authRef: `env:${markerName}` });
    const out = fingerprintConnectorConfig("openai-live", input);

    // Reconstruct what the helper canonicalises:
    const expectedAuth = `env:${createHash("sha256").update(markerName).digest("hex").slice(0, 16)}`;
    const canonical = {
      connectorId: "openai-live",
      typeFamily: input.typeFamily,
      presetId: input.presetId,
      settings: input.settings,
      capabilities: [...input.capabilities].sort(),
      allowLocalNetwork: input.allowLocalNetwork,
      authRef: expectedAuth,
    };
    const expected = createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex");

    expect(out).toBe(expected);
    // And the bytes that went into the SHA-256 do NOT contain the env name.
    expect(JSON.stringify(canonical)).not.toContain(markerName);
  });
});
