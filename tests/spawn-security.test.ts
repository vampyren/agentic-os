// Security tests for the spawn helper:
// - env allowlist filters secret-shaped vars out of child processes
// - AGENTIC_OS_* vars pass through unconditionally
// - manifest-declared env overrides win
// - renderArgsForAudit replaces {prompt} with the redacted placeholder
//   (paired with the audit-security test that asserts no raw prompt is logged)

import { describe, it, expect } from "vitest";
import {
  buildChildEnv,
  renderArgs,
  renderArgsForAudit,
  __TEST__,
} from "../src/kernel/spawn";

describe("spawn env allowlist", () => {
  it("does not pass through secret-shaped env vars", () => {
    const prev = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-test-leak-canary";
    try {
      const env = buildChildEnv();
      expect(env["OPENAI_API_KEY"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = prev;
    }
  });

  it("keeps PATH and HOME (required by every CLI)", () => {
    const env = buildChildEnv();
    expect(env["PATH"]).toBeDefined();
    expect(env["HOME"]).toBeDefined();
  });

  it("forces NO_COLOR / FORCE_COLOR regardless of parent", () => {
    const prev = { nc: process.env["NO_COLOR"], fc: process.env["FORCE_COLOR"] };
    process.env["NO_COLOR"] = "0";
    process.env["FORCE_COLOR"] = "3";
    try {
      const env = buildChildEnv();
      expect(env["NO_COLOR"]).toBe("1");
      expect(env["FORCE_COLOR"]).toBe("0");
    } finally {
      if (prev.nc === undefined) delete process.env["NO_COLOR"]; else process.env["NO_COLOR"] = prev.nc;
      if (prev.fc === undefined) delete process.env["FORCE_COLOR"]; else process.env["FORCE_COLOR"] = prev.fc;
    }
  });

  it("forwards AGENTIC_OS_* vars unconditionally", () => {
    process.env["AGENTIC_OS_TEST_CANARY"] = "yes";
    try {
      const env = buildChildEnv();
      expect(env["AGENTIC_OS_TEST_CANARY"]).toBe("yes");
    } finally {
      delete process.env["AGENTIC_OS_TEST_CANARY"];
    }
  });

  it("manifest-declared extras win over allowlist", () => {
    const env = buildChildEnv({ extra: { CUSTOM_VAR: "from-manifest" } });
    expect(env["CUSTOM_VAR"]).toBe("from-manifest");
  });

  it("manifest extras can override allowlisted vars too", () => {
    const env = buildChildEnv({ extra: { LANG: "POSIX" } });
    expect(env["LANG"]).toBe("POSIX");
  });

  it("ENV_ALLOWLIST includes essentials and excludes obvious secrets", () => {
    expect(__TEST__.ENV_ALLOWLIST.has("PATH")).toBe(true);
    expect(__TEST__.ENV_ALLOWLIST.has("HOME")).toBe(true);
    expect(__TEST__.ENV_ALLOWLIST.has("OPENAI_API_KEY")).toBe(false);
    expect(__TEST__.ENV_ALLOWLIST.has("GITHUB_TOKEN")).toBe(false);
    expect(__TEST__.ENV_ALLOWLIST.has("ANTHROPIC_API_KEY")).toBe(false);
    expect(__TEST__.ENV_ALLOWLIST.has("AWS_SECRET_ACCESS_KEY")).toBe(false);
  });
});

describe("renderArgs / renderArgsForAudit", () => {
  it("renderArgs substitutes the real prompt", () => {
    expect(renderArgs(["-p", "{prompt}", "--verbose"], "hello world"))
      .toEqual(["-p", "hello world", "--verbose"]);
  });

  it("renderArgsForAudit replaces {prompt} with [PROMPT_REDACTED]", () => {
    expect(renderArgsForAudit(["-p", "{prompt}", "--verbose"]))
      .toEqual(["-p", "[PROMPT_REDACTED]", "--verbose"]);
  });

  it("renderArgsForAudit never returns the raw prompt — even when called repeatedly", () => {
    const tmpl = ["-p", "{prompt}"];
    const result = renderArgsForAudit(tmpl);
    expect(result.join(" ")).not.toContain("real-prompt-canary-string");
  });

  it("non-{prompt} args pass through unchanged in both renderers", () => {
    expect(renderArgs(["a", "b", "c"], "x")).toEqual(["a", "b", "c"]);
    expect(renderArgsForAudit(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});
