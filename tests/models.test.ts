// Model context-window lookup. Anthropic's [1m] / [200k] annotation
// overrides the base; unknown models fall back to a safe default.

import { describe, it, expect } from "vitest";
import { resolveModel, contextBreakdown } from "../src/lib/models";

describe("resolveModel — exact + family + annotation", () => {
  it("matches exact model strings", () => {
    expect(resolveModel("claude-opus-4-7").contextTokens).toBe(200_000);
    expect(resolveModel("gpt-5.5").contextTokens).toBe(272_000);
  });

  it("Anthropic [1m] annotation overrides to 1,000,000", () => {
    expect(resolveModel("claude-opus-4-7[1m]").contextTokens).toBe(1_000_000);
    expect(resolveModel("claude-sonnet-4-6[1m]").contextTokens).toBe(1_000_000);
  });

  it("Anthropic [200k] annotation overrides to 200,000", () => {
    expect(resolveModel("claude-opus-4-7[200k]").contextTokens).toBe(200_000);
  });

  it("family-prefix fallback resolves unknown specific models", () => {
    expect(resolveModel("claude-opus-9-99").family).toBe("claude");
    expect(resolveModel("gpt-5.7").family).toBe("openai");
    expect(resolveModel("gemini-3.0-ultra").contextTokens).toBe(1_000_000);
    expect(resolveModel("qwen3.9-coder:70b").family).toBe("qwen");
  });

  it("totally unknown models fall back to 200k default", () => {
    expect(resolveModel("totally-novel-model-2030").contextTokens).toBe(200_000);
  });

  it("empty / missing model string handled gracefully", () => {
    expect(resolveModel("").contextTokens).toBe(200_000);
  });
});

describe("contextBreakdown", () => {
  it("sums input + cache read + cache creation as contextTotal", () => {
    const b = contextBreakdown({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 500,
    });
    expect(b.contextTotal).toBe(5600);
    expect(b.usedTotal).toBe(5650);
  });

  it("handles missing fields as zero", () => {
    expect(contextBreakdown({}).usedTotal).toBe(0);
    expect(contextBreakdown({ inputTokens: 10 }).contextTotal).toBe(10);
  });
});
