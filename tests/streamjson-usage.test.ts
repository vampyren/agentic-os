// streamJson transport: extractUsage handles the three event shapes Claude
// Code's stream-json emits — system.init (model only), assistant.message.usage
// (per-turn), and result.usage (cumulative + cost).
//
// Plus: stream() contract — stderr is buffered (not emitted as error per
// chunk), timeouts kill the child and surface a single classified error,
// and an unbounded stdout buffer triggers a defensive abort.

import { describe, it, expect } from "vitest";
import { extractUsage, createStreamJsonTransport } from "../src/kernel/transports/streamJson";
import type { AgentEvent, AgentManifest } from "../src/kernel/types";

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

// ─── stream() contract — stderr buffering + timeout + buffer cap ────────────

/**
 * Build a streamJson manifest that runs `node -e <script>` so the test stays
 * deterministic and avoids depending on a real `claude` install. `safeSpawn`
 * resolves `bin` via PATH, and node is guaranteed present on the test runner.
 *
 * The script is `console.log`'d as a single arg via the `{prompt}` placeholder
 * so we don't have to template it into argv ourselves.
 */
function fakeStreamJsonManifest(script: string, opts: { timeoutMs?: number } = {}): AgentManifest {
  return {
    name: "fake-stream-json",
    displayName: "Fake StreamJson",
    transport: "streamJson",
    transportConfig: {
      bin: "node",
      args: ["-e", script, "--", "{prompt}"],
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    },
  };
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe("streamJson stream — stderr buffering policy", () => {
  it("does NOT emit error events for stderr written by a successful run", async () => {
    // Script: write a benign warning to stderr, write a valid NDJSON result
    // event to stdout, exit 0. The contract under test: even though stderr
    // got non-empty data, no `error` event must be yielded.
    const script = [
      "process.stderr.write('[mcp] deprecation notice: foo will be removed\\n');",
      "process.stderr.write('[telemetry] heartbeat ok\\n');",
      "console.log(JSON.stringify({type:'result', result:'hello world', model:'fake'}));",
    ].join(" ");
    const t = createStreamJsonTransport(fakeStreamJsonManifest(script));
    const events = await collect(t.stream({ prompt: "ignored" }));
    const errs = events.filter((e) => e.kind === "error");
    expect(errs, "stderr-on-success must not produce error events").toHaveLength(0);
    // We should still see the fallback token from the result event.
    const tokens = events.filter((e): e is Extract<AgentEvent, { kind: "token" }> => e.kind === "token");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((t) => t.text).join("")).toContain("hello world");
    // Terminal done event with exit 0.
    const done = events.find((e) => e.kind === "done");
    if (done?.kind === "done") expect(done.exitCode).toBe(0);
  });

  it("emits one error event with buffered stderr on non-zero exit", async () => {
    const script = [
      "process.stderr.write('boom: bad config\\n');",
      "process.exit(7);",
    ].join(" ");
    const t = createStreamJsonTransport(fakeStreamJsonManifest(script));
    const events = await collect(t.stream({ prompt: "ignored" }));
    const errs = events.filter((e): e is Extract<AgentEvent, { kind: "error" }> => e.kind === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/boom: bad config/);
    const done = events.find((e) => e.kind === "done");
    if (done?.kind === "done") expect(done.exitCode).toBe(7);
  });

  it("kills the child and emits a timeout error when the wall-clock cap fires", async () => {
    // Script: write nothing, just sleep for far longer than the timeout.
    const script = "setTimeout(()=>{}, 60000);";
    const t = createStreamJsonTransport(fakeStreamJsonManifest(script, { timeoutMs: 250 }));
    const startedAt = Date.now();
    const events = await collect(t.stream({ prompt: "ignored" }));
    const elapsed = Date.now() - startedAt;
    // Should fire within a few hundred ms past the deadline, definitely not 60s.
    expect(elapsed).toBeLessThan(10_000);
    const errs = events.filter((e): e is Extract<AgentEvent, { kind: "error" }> => e.kind === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /timeout/.test(e.message))).toBe(true);
  }, 12_000);
});
