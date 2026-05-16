// Unit tests for the post-run usage extractors (Hermes session-export
// parser). The actual subprocess invocation is integration territory and
// runs only against a real Hermes install; here we cover the two pure
// helpers — list-output parsing and json-to-AgentUsage mapping.

import { describe, it, expect } from "vitest";
import {
  parseSessionIdFromListOutput,
  hermesSessionJsonToUsage,
} from "../src/kernel/postRunUsage";

describe("parseSessionIdFromListOutput", () => {
  const sampleOutput = `
Preview                                            Last Active   Src    ID
───────────────────────────────────────────────────────────────────────────
hello , Write a small markdown table comparing t   12m ago       cli    20260516_164735_fd2846
`;

  it("extracts the session id from a single-row hermes sessions list", () => {
    expect(parseSessionIdFromListOutput(sampleOutput)).toBe("20260516_164735_fd2846");
  });

  it("handles cron-prefixed session ids", () => {
    const out = `
Preview                                            Last Active   Src    ID
───────────────────────────────────────────────────────────────────────────
[IMPORTANT: ...                                    3m ago        cron   cron_47ab1f7fb80f_20260516_165612
`;
    expect(parseSessionIdFromListOutput(out)).toBe("cron_47ab1f7fb80f_20260516_165612");
  });

  it("returns undefined for empty / header-only output", () => {
    expect(parseSessionIdFromListOutput("")).toBeUndefined();
    expect(parseSessionIdFromListOutput("Preview Last Active Src ID\n──────────\n")).toBeUndefined();
  });

  it("walks from the bottom — most recent session wins on multi-row output", () => {
    const out = `
Preview                                            Last Active   Src    ID
───────────────────────────────────────────────────────────────────────────
older                                              1h ago        cli    20260516_100000_aaaaaa
newer                                              5m ago        cli    20260516_165612_bbbbbb
`;
    expect(parseSessionIdFromListOutput(out)).toBe("20260516_165612_bbbbbb");
  });
});

describe("hermesSessionJsonToUsage", () => {
  it("maps the snake_case fields from hermes sessions export to AgentUsage", () => {
    const sample = {
      id: "20260516_164735_fd2846",
      model: "gpt-5.5",
      input_tokens: 14691,
      output_tokens: 91,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      estimated_cost_usd: 0.0,
      actual_cost_usd: 0.12,
      messages: [],
    };
    const u = hermesSessionJsonToUsage(sample);
    expect(u).toBeDefined();
    expect(u!.model).toBe("gpt-5.5");
    expect(u!.inputTokens).toBe(14691);
    expect(u!.outputTokens).toBe(91);
    expect(u!.cacheReadInputTokens).toBe(0);
    expect(u!.cacheCreationInputTokens).toBe(0);
    expect(u!.totalCostUsd).toBe(0.12);
  });

  it("prefers actual_cost_usd over estimated_cost_usd", () => {
    expect(
      hermesSessionJsonToUsage({ actual_cost_usd: 0.5, estimated_cost_usd: 0.1 })?.totalCostUsd,
    ).toBe(0.5);
  });

  it("falls back to estimated_cost_usd when actual is null/missing", () => {
    expect(
      hermesSessionJsonToUsage({ actual_cost_usd: null, estimated_cost_usd: 0.07 })?.totalCostUsd,
    ).toBe(0.07);
  });

  // v0.2.8 (Hermes review): empty object input now returns undefined, not
  // an empty AgentUsage — so registry/store guards don't bump turn counters
  // with zero data.
  it("returns undefined when no meaningful usage fields are present", () => {
    expect(hermesSessionJsonToUsage({})).toBeUndefined();
    expect(hermesSessionJsonToUsage({ messages: [], id: "x" })).toBeUndefined();
  });

  it("returns undefined when all numeric fields are zero AND no model", () => {
    expect(
      hermesSessionJsonToUsage({ input_tokens: 0, output_tokens: 0, actual_cost_usd: 0 }),
    ).toBeUndefined();
  });

  it("returns model-only usage if model is present (model is meaningful)", () => {
    const u = hermesSessionJsonToUsage({ model: "gpt-5.5" });
    expect(u?.model).toBe("gpt-5.5");
  });

  it("ignores non-numeric token fields gracefully", () => {
    const u = hermesSessionJsonToUsage({ input_tokens: "nope" as unknown as number, model: "x" });
    expect(u?.model).toBe("x");
    expect(u?.inputTokens).toBeUndefined();
  });
});
