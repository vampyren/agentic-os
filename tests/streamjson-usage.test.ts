// streamJson transport: extractUsage handles the three event shapes Claude
// Code's stream-json emits — system.init (model only), assistant.message.usage
// (per-turn), and result.usage (cumulative + cost).

import { describe, it, expect } from "vitest";
import { extractUsage } from "../src/kernel/transports/streamJson";

describe("streamJson extractUsage", () => {
  it("pulls model out of a system init event", () => {
    const evt = { type: "system", subtype: "init", model: "claude-opus-4-7" };
    // extractUsage doesn't gate on type — caller does. We just confirm the
    // model field would be pulled when present.
    const u = extractUsage(evt);
    expect(u?.model).toBe("claude-opus-4-7");
  });

  it("pulls per-turn usage out of an assistant event's message.usage", () => {
    const evt = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          cache_read_input_tokens: 1500,
          cache_creation_input_tokens: 200,
        },
      },
    };
    const u = extractUsage(evt);
    expect(u?.inputTokens).toBe(12);
    expect(u?.outputTokens).toBe(4);
    expect(u?.cacheReadInputTokens).toBe(1500);
    expect(u?.cacheCreationInputTokens).toBe(200);
  });

  it("pulls cumulative usage + cost out of a result event", () => {
    const evt = {
      type: "result",
      result: "final text",
      total_cost_usd: 0.0598,
      usage: { input_tokens: 6, output_tokens: 86 },
      model: "claude-opus-4-7",
    };
    const u = extractUsage(evt);
    expect(u?.totalCostUsd).toBeCloseTo(0.0598, 4);
    expect(u?.inputTokens).toBe(6);
    expect(u?.outputTokens).toBe(86);
    expect(u?.model).toBe("claude-opus-4-7");
  });

  it("returns undefined for events without any usage signal", () => {
    expect(extractUsage({ type: "stream_event", event: { delta: { text: "hi" } } })).toBeUndefined();
    expect(extractUsage({ type: "user", message: { content: [] } })).toBeUndefined();
    expect(extractUsage({})).toBeUndefined();
  });

  it("tolerates partial usage shapes (only some fields present)", () => {
    expect(extractUsage({ type: "assistant", message: { usage: { input_tokens: 5 } } }))
      .toMatchObject({ inputTokens: 5 });
    expect(extractUsage({ type: "result", total_cost_usd: 0.01 }))
      .toMatchObject({ totalCostUsd: 0.01 });
  });
});
