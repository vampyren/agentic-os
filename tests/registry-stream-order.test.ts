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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { __TEST__ } from "../src/kernel/registry";
import type {
  AgentEvent, AgentManifest, HealthReport, Transport, StreamOpts, AgentUsage,
} from "../src/kernel/types";

// Mock runPostRunUsage at module level so individual tests can have it
// return a specific AgentUsage (or undefined) without standing up a real
// hermes CLI. Hoisted by vitest so the registry imports the mocked version.
vi.mock("../src/kernel/postRunUsage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/kernel/postRunUsage")>();
  return {
    ...actual,
    runPostRunUsage: vi.fn(async () => undefined),
  };
});
const { runPostRunUsage } = await import("../src/kernel/postRunUsage");
const mockedRun = vi.mocked(runPostRunUsage);

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

describe("registry.stream — postRunUsage emits BEFORE done", () => {
  // Hermes v0.2.8 review "worth tightening": the existing tests prove
  // ordering in general, but NOT the postRunUsage-specific branch. This
  // suite mocks runPostRunUsage and asserts that any usage it returns is
  // yielded before the terminal done event — so any consumer treating
  // done as terminal still sees the telemetry.
  it("yields postRunUsage-derived usage event before the terminal done", async () => {
    mockedRun.mockResolvedValueOnce({ model: "test", inputTokens: 100, outputTokens: 50 } as AgentUsage);

    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(
      reg,
      fakeManifest({
        postRunUsage: { parser: "hermes-session-export" },
      } as Partial<AgentManifest>),
      fakeTransport([
        { kind: "token", text: "OK" },
        { kind: "done", durationMs: 5, exitCode: 0 },
      ]),
    );

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    const usageIdx = kinds.lastIndexOf("usage");
    const doneIdx = kinds.lastIndexOf("done");
    expect(usageIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBe(kinds.length - 1);
    expect(usageIdx).toBeLessThan(doneIdx);
  });

  it("postRunUsage returning empty usage does NOT emit a usage event", async () => {
    // Even though postRunUsage might return undefined (parser returned no
    // meaningful fields), the registry must not yield an empty usage event
    // — that would defeat the v0.2.8 suppression.
    mockedRun.mockResolvedValueOnce(undefined);

    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(
      reg,
      fakeManifest({
        postRunUsage: { parser: "hermes-session-export" },
      } as Partial<AgentManifest>),
      fakeTransport([
        { kind: "token", text: "OK" },
        { kind: "done", durationMs: 5, exitCode: 0 },
      ]),
    );

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["token", "done"]);
  });

  it("postRunUsage extractor failure is fail-soft — call still succeeds, no usage event", async () => {
    mockedRun.mockRejectedValueOnce(new Error("simulated extractor crash"));

    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(
      reg,
      fakeManifest({
        postRunUsage: { parser: "hermes-session-export" },
      } as Partial<AgentManifest>),
      fakeTransport([
        { kind: "token", text: "OK" },
        { kind: "done", durationMs: 5, exitCode: 0 },
      ]),
    );

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const kinds = events.map((e) => e.kind);
    // Call still reports done with exit 0 — the operator got their reply,
    // the extractor crash is silent telemetry-loss only.
    expect(kinds).toEqual(["token", "done"]);
    const doneEvent = events.find((e) => e.kind === "done");
    if (doneEvent?.kind === "done") {
      expect(doneEvent.exitCode).toBe(0);
    }
  });
});

describe("registry.stream — error path duration is elapsed, not epoch (v0.2.10)", () => {
  // Hermes v0.2.8 review: the catch path was setting
  // `durationMs: Date.now()` (epoch milliseconds). Should be elapsed.
  it("catch path reports a reasonable durationMs, never epoch-shaped", async () => {
    const reg = __TEST__.newRegistry();
    // Transport throws synchronously inside the async iterator.
    const explodingTransport: Transport = {
      health: async () => ({ status: "live", checkedAt: Date.now() }),
      async *stream() {
        throw new Error("boom");
      },
    };
    __TEST__.injectAgent(reg, fakeManifest(), explodingTransport);

    const events = await collect(reg.stream("fake-agent", { prompt: "x" }));
    const doneEvent = events.find((e) => e.kind === "done");
    if (doneEvent?.kind === "done") {
      // Elapsed should be < 1 minute for a test that throws instantly.
      // The epoch-ms value would be ~1.7e12, so this also catches the bug.
      expect(doneEvent.durationMs).toBeLessThan(60_000);
      expect(doneEvent.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
