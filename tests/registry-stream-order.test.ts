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
import { bus } from "../src/kernel/bus";
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

describe("registry.stream — operator cancellation reclassifies to status: cancelled (F4)", () => {
  // Per the F4 contract, when the caller's AbortController has fired by the
  // time the stream ends, the registry must:
  //   - NOT write `agent.invoke.error` (even if the transport defensively
  //     yielded a stray error event in violation of the contract);
  //   - write `agent.invoke.complete` with `status: "cancelled"` so audit
  //     consumers can distinguish operator cancellation from real failures.
  //
  // We reach into the test audit dir and parse JSONL to verify.

  async function readAuditKinds(): Promise<Array<{ kind: string; status?: string }>> {
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(auditDir, `${day}.jsonl`);
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const e = JSON.parse(line) as { kind: string; status?: string };
        return { kind: e.kind, ...(e.status !== undefined ? { status: e.status } : {}) };
      });
  }

  it("aborted signal: audit gets agent.invoke.complete status:cancelled, NOT agent.invoke.error", async () => {
    const reg = __TEST__.newRegistry();
    // Transport yields a token + done. It does NOT yield an error event:
    // simulating a well-behaved transport that respected the F4 contract.
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "token", text: "partial" },
      { kind: "done", durationMs: 5, exitCode: null },
    ]));

    // Caller pre-aborts the signal — equivalent to the operator having hit
    // Stop / navigated away by the time the registry finishes draining.
    const controller = new AbortController();
    controller.abort();

    const events = await collect(reg.stream("fake-agent", {
      prompt: "x",
      signal: controller.signal,
    }));

    // Stream must still terminate cleanly with `done`.
    expect(events.find((e) => e.kind === "done")).toBeDefined();

    // Audit must show complete:cancelled and NOT contain agent.invoke.error
    // for this run.
    const lines = await readAuditKinds();
    const lastInvoke = lines.findLast((l) => l.kind === "agent.invoke");
    const lastComplete = lines.findLast((l) => l.kind === "agent.invoke.complete");
    const lastError = lines.findLast((l) => l.kind === "agent.invoke.error");
    expect(lastInvoke, "should have logged the invoke").toBeDefined();
    expect(lastComplete, "should have logged a complete envelope").toBeDefined();
    expect(lastComplete?.status).toBe("cancelled");
    // Defensive: no fresh agent.invoke.error in this test's tail.
    if (lastError) {
      // If a prior test wrote an error entry, ensure it's not THIS test's
      // run by checking it comes before our latest invoke line. (Vitest
      // runs in a shared audit dir for the describe block; ordering check
      // is enough to prove this run didn't add one.)
      const invokeIdx = lines.lastIndexOf(lastInvoke!);
      const errorIdx = lines.lastIndexOf(lastError);
      expect(errorIdx).toBeLessThan(invokeIdx);
    }
  });

  it("aborted signal + transport defensively yields error: still reclassifies to cancelled", async () => {
    // Backstop: even if a transport ignored the F4 contract and yielded a
    // kind:"error" event on cancellation, the registry must not promote
    // that to an agent.invoke.error audit entry — the caller's signal IS
    // the source of truth.
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "error", message: "terminated by signal" },
      { kind: "done", durationMs: 5, exitCode: null },
    ]));

    const controller = new AbortController();
    controller.abort();

    await collect(reg.stream("fake-agent", {
      prompt: "x",
      signal: controller.signal,
    }));

    const lines = await readAuditKinds();
    const lastInvoke = lines.findLast((l) => l.kind === "agent.invoke");
    const lastComplete = lines.findLast((l) => l.kind === "agent.invoke.complete");
    const lastError = lines.findLast((l) => l.kind === "agent.invoke.error");

    expect(lastComplete?.status).toBe("cancelled");

    // If there's an error line, it must be from a prior test (older index).
    if (lastError) {
      const invokeIdx = lines.lastIndexOf(lastInvoke!);
      const errorIdx = lines.lastIndexOf(lastError);
      expect(
        errorIdx,
        "operator cancellation must NOT add a fresh agent.invoke.error entry",
      ).toBeLessThan(invokeIdx);
    }
  });

  it("aborted signal + cancellation-shaped error: no bus agent.invoke.error emitted (Jarvis Blocker 2)", async () => {
    // Jarvis F4 review Blocker 2: even though audit now suppresses errors
    // on cancellation, the bus used to receive `agent.invoke.error` before
    // classification ran. This test pins the fix: cancellation-shaped errors
    // must stay silent on the bus too.
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "error", message: "terminated by signal" },
      { kind: "done", durationMs: 5, exitCode: null },
    ]));

    const seenBus: Array<{ kind: string }> = [];
    const off = bus.on((e) => seenBus.push({ kind: e.kind }));

    const controller = new AbortController();
    controller.abort();

    try {
      await collect(reg.stream("fake-agent", {
        prompt: "x",
        signal: controller.signal,
      }));
    } finally {
      off();
    }

    expect(
      seenBus.find((e) => e.kind === "agent.invoke.error"),
      "operator cancellation must NOT emit agent.invoke.error on the bus",
    ).toBeUndefined();

    // Sanity: the complete envelope IS emitted on the bus for this run.
    expect(
      seenBus.find((e) => e.kind === "agent.invoke.complete"),
      "complete envelope should still be emitted on the bus",
    ).toBeDefined();
  });

  it("aborted signal + REAL non-zero failure: still surfaces as error on bus AND audit (Jarvis Blocker 1)", async () => {
    // Jarvis F4 review Blocker 1: the original `cancelled =
    // opts.signal?.aborted === true` predicate would mask real failures
    // whenever the request signal happened to be aborted by finalization
    // time. Real failures must stay errors. Here the transport yields a
    // non-zero exit + a non-abort-shaped error message; the pre-aborted
    // signal must NOT promote this to cancellation.
    const reg = __TEST__.newRegistry();
    __TEST__.injectAgent(reg, fakeManifest(), fakeTransport([
      { kind: "error", message: "exit 7" },
      { kind: "done", durationMs: 5, exitCode: 7 },
    ]));

    const seenBus: Array<{ kind: string }> = [];
    const off = bus.on((e) => seenBus.push({ kind: e.kind }));

    const controller = new AbortController();
    controller.abort(); // pre-aborted, simulating late abort racing a real failure

    try {
      await collect(reg.stream("fake-agent", {
        prompt: "x",
        signal: controller.signal,
      }));
    } finally {
      off();
    }

    // Bus MUST surface agent.invoke.error — real failures don't get masked.
    expect(
      seenBus.find((e) => e.kind === "agent.invoke.error"),
      "real non-zero failure must surface as agent.invoke.error on bus even under aborted signal",
    ).toBeDefined();

    // Audit MUST contain a fresh agent.invoke.error for this run.
    const lines = await readAuditKinds();
    const lastInvoke = lines.findLast((l) => l.kind === "agent.invoke");
    const lastError = lines.findLast((l) => l.kind === "agent.invoke.error");
    const lastComplete = lines.findLast((l) => l.kind === "agent.invoke.complete");

    expect(lastError, "real failure must write agent.invoke.error to audit").toBeDefined();
    const invokeIdx = lines.lastIndexOf(lastInvoke!);
    const errorIdx = lines.lastIndexOf(lastError!);
    expect(
      errorIdx,
      "fresh agent.invoke.error must come AFTER this run's invoke line",
    ).toBeGreaterThan(invokeIdx);

    // Complete envelope must NOT be marked cancelled — this was a real failure.
    expect(lastComplete?.status).not.toBe("cancelled");
  });

  it("aborted signal + thrown generic error in catch path: stays classified as error", async () => {
    // Catch-path coverage: a transport that throws (not yields kind:"error")
    // with a non-abort-shaped message must remain an error even when the
    // request signal has been aborted. Generic throws are not cancellation.
    const reg = __TEST__.newRegistry();
    const explodingTransport: Transport = {
      health: async () => ({ status: "live", checkedAt: Date.now() }),
      async *stream() {
        throw new Error("boom");
      },
    };
    __TEST__.injectAgent(reg, fakeManifest(), explodingTransport);

    const seenBus: Array<{ kind: string }> = [];
    const off = bus.on((e) => seenBus.push({ kind: e.kind }));

    const controller = new AbortController();
    controller.abort();

    try {
      await collect(reg.stream("fake-agent", {
        prompt: "x",
        signal: controller.signal,
      }));
    } finally {
      off();
    }

    expect(
      seenBus.find((e) => e.kind === "agent.invoke.error"),
      "generic thrown error must surface as agent.invoke.error on bus even under aborted signal",
    ).toBeDefined();

    const lines = await readAuditKinds();
    const lastInvoke = lines.findLast((l) => l.kind === "agent.invoke");
    const lastError = lines.findLast((l) => l.kind === "agent.invoke.error");
    const lastComplete = lines.findLast((l) => l.kind === "agent.invoke.complete");

    expect(lastError).toBeDefined();
    const invokeIdx = lines.lastIndexOf(lastInvoke!);
    const errorIdx = lines.lastIndexOf(lastError!);
    expect(errorIdx).toBeGreaterThan(invokeIdx);
    expect(lastComplete?.status).not.toBe("cancelled");
  });
});
