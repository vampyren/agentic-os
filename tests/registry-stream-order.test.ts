// Registry event ordering — integration test (Hermes review of v0.2.6 + v0.2.7).
//
// Canonical run order out of registry.stream():
//   1. token | usage  (interleaved as transport emits)
//   2. error          (only on failure)
//   3. usage          (from postRunUsage, if any)
//   4. done           ← terminal event for this run
//
// Tests use the __TEST__ helper to build an isolated Registry with a fake
// transport. No real Claude/Hermes needed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { __TEST__ } from "../src/kernel/registry";
import type {
  AgentEvent, AgentManifest, HealthReport, Transport, StreamOpts, AgentUsage,
} from "../src/kernel/types";

// Quiet audit during the test — redirect to a tmpdir.
let auditDir: string;
const prevAuditEnv = process.env["AGENTIC_OS_AUDIT_DIR"];
beforeAll(async () => {
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-stream-order-"));
  process.env["AGENTIC_OS_AUDIT_DIR"] = auditDir;
});
afterAll(async () => {
  if (prevAuditEnv === undefined) delete process.env["AGENTIC_OS_AUDIT_DIR"];
  else process.env["AGENTIC_OS_AUDIT_DIR"] = prevAuditEnv;
  await fs.rm(auditDir, { recursive: true, force: true });
});

/**
 * Build a fake transport that emits the supplied events in order. Used to
 * stand in for a real subprocess/streamJson transport in integration tests.
 */
function fakeTransport(events: AgentEvent[]): Transport {
  return {
    health: async (): Promise<HealthReport> => ({
      status: "live",
      checkedAt: Date.now(),
    }),
    async *stream(_opts: StreamOpts): AsyncIterable<AgentEvent> {
      for (const e of events) yield e;
    },
  };
}

function fakeManifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    name: "fake-agent",
    displayName: "Fake Agent",
    transport: "subprocess",
    transportConfig: { bin: "/bin/true", args: [] },
    ...overrides,
  } as AgentManifest;
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe("registry.stream — event ordering", () => {
  it("transport-emitted events: token... → done (no postRunUsage)", async () => {
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "token", text: "Hello " },
      { kind: "token", text: "world" },
      { kind: "done", durationMs: 42, exitCode: 0 },
    ]));

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["token", "token", "done"]);
    // done MUST be last.
    expect(kinds[kinds.length - 1]).toBe("done");
  });

  it("interleaved token + usage events preserve order; done is last", async () => {
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "usage", usage: { model: "test-1" } as AgentUsage },
      { kind: "token", text: "a" },
      { kind: "usage", usage: { inputTokens: 10 } as AgentUsage },
      { kind: "token", text: "b" },
      { kind: "done", durationMs: 5, exitCode: 0 },
    ]));

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["usage", "token", "usage", "token", "done"]);
    expect(kinds[kinds.length - 1]).toBe("done");
  });

  it("drops empty {} usage at the kernel boundary (UI never sees it)", async () => {
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "usage", usage: {} as AgentUsage },                                  // filtered
      { kind: "token", text: "a" },
      { kind: "usage", usage: { inputTokens: 0, outputTokens: 0 } as AgentUsage }, // also empty by meaning
      { kind: "usage", usage: { inputTokens: 7 } as AgentUsage },                  // keep
      { kind: "done", durationMs: 1, exitCode: 0 },
    ]));

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const usageEvents = events.filter((e) => e.kind === "usage");
    expect(usageEvents).toHaveLength(1);
    if (usageEvents[0]?.kind === "usage") {
      expect(usageEvents[0].usage.inputTokens).toBe(7);
    }
  });

  it("unknown agent name yields error + done in that order", async () => {
    const reg = __TEST__.newRegistry();
    const events = await collect(reg.stream("does-not-exist", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["error", "done"]);
  });

  it("error from transport: error event yielded, done still terminal", async () => {
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "error", message: "transport failed" },
      { kind: "done", durationMs: 1, exitCode: 1 },
    ]));

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("error");
    expect(kinds[kinds.length - 1]).toBe("done");
  });
});
