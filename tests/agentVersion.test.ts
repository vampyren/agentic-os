import { describe, it, expect } from "vitest";
import { extractVersion } from "../src/lib/agentVersion";

describe("extractVersion", () => {
  it("pulls a clean semver from the claude-code --version format", () => {
    expect(extractVersion("2.1.144 (Claude Code)")).toBe("2.1.144");
  });

  it("pulls v-prefixed semver from the hermes --version format (regression)", () => {
    // Hermes prints `Hermes Agent v0.14.0 (2026.5.16)` — the previous
    // `split(" ")[0]` consumer rendered the word "Hermes" on the Mission
    // Control card, which read as "version missing". The helper must
    // surface the actual version token.
    expect(extractVersion("Hermes Agent v0.14.0 (2026.5.16)")).toBe("v0.14.0");
  });

  it("handles a bare semver with no other text", () => {
    expect(extractVersion("0.2.12")).toBe("0.2.12");
    expect(extractVersion("v1.0")).toBe("v1.0");
  });

  it("handles 4-segment versions", () => {
    expect(extractVersion("foo v1.2.3.4 bar")).toBe("v1.2.3.4");
  });

  it("returns the placeholder for empty / undefined / whitespace input", () => {
    expect(extractVersion(undefined)).toBe("—");
    expect(extractVersion(null)).toBe("—");
    expect(extractVersion("")).toBe("—");
    expect(extractVersion("   ")).toBe("—");
  });

  it("respects a custom placeholder", () => {
    expect(extractVersion(undefined, "n/a")).toBe("n/a");
  });

  it("falls back to first token when no version pattern matches", () => {
    // Defensive: a CLI prints something weird with no semver-looking
    // substring — better to show its first word than a bare em-dash.
    expect(extractVersion("alpha build candidate")).toBe("alpha");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(extractVersion("  2.1.144 (Claude Code)\n")).toBe("2.1.144");
  });
});
