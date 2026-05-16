// chatStore: in-memory + localStorage-backed per-agent chat session store.
// The localStorage paths are no-ops under Node (window is undefined), so we
// only exercise the in-memory state machine here.

import { describe, it, expect, beforeEach } from "vitest";
import { chatStore } from "../src/lib/chatStore";

beforeEach(() => {
  // Fresh state between tests.
  for (const name of ["alpha", "beta", "gamma"]) {
    chatStore.newSession(name);
  }
});

describe("chatStore — basic append + isolation", () => {
  it("starts empty for an unknown agent", () => {
    const s = chatStore.get("never-seen");
    expect(s.msgs).toEqual([]);
    expect(s.sessionUsage.turns).toBe(0);
    expect(s.lastUsage).toBeNull();
  });

  it("isolates state per agent", () => {
    chatStore.appendUserMessage("alpha", "first prompt");
    chatStore.appendUserMessage("beta", "different prompt");
    expect(chatStore.get("alpha").msgs).toHaveLength(1);
    expect(chatStore.get("beta").msgs).toHaveLength(1);
    expect(chatStore.get("alpha").msgs[0]!.text).toBe("first prompt");
    expect(chatStore.get("beta").msgs[0]!.text).toBe("different prompt");
  });

  it("rolls cumulative usage into sessionUsage when assistant message has usage", () => {
    chatStore.appendUserMessage("alpha", "q1");
    chatStore.appendAssistantMessage("alpha", {
      role: "assistant", text: "a1", ts: Date.now(),
      usage: { inputTokens: 100, outputTokens: 20, totalCostUsd: 0.01, model: "test-model" },
    });
    chatStore.appendUserMessage("alpha", "q2");
    chatStore.appendAssistantMessage("alpha", {
      role: "assistant", text: "a2", ts: Date.now(),
      usage: { inputTokens: 50, outputTokens: 10, totalCostUsd: 0.005 },
    });
    const s = chatStore.get("alpha");
    expect(s.sessionUsage.turns).toBe(2);
    expect(s.sessionUsage.inputTokens).toBe(150);
    expect(s.sessionUsage.outputTokens).toBe(30);
    expect(s.sessionUsage.totalCostUsd).toBeCloseTo(0.015, 4);
    expect(s.sessionUsage.model).toBe("test-model");   // last-known model sticks
  });

  it("does not increment turns when assistant message has no usage", () => {
    chatStore.appendAssistantMessage("alpha", {
      role: "assistant", text: "no-usage reply", ts: Date.now(),
    });
    expect(chatStore.get("alpha").sessionUsage.turns).toBe(0);
  });
});

describe("chatStore — newSession + subscribe", () => {
  it("newSession clears everything for that agent only", () => {
    chatStore.appendUserMessage("alpha", "stays after b's clear");
    chatStore.appendUserMessage("beta", "this gets cleared");
    chatStore.appendAssistantMessage("beta", {
      role: "assistant", text: "x", ts: Date.now(),
      usage: { inputTokens: 5, outputTokens: 5 },
    });

    chatStore.newSession("beta");
    expect(chatStore.get("beta").msgs).toEqual([]);
    expect(chatStore.get("beta").sessionUsage.turns).toBe(0);
    expect(chatStore.get("beta").lastUsage).toBeNull();
    // Alpha untouched.
    expect(chatStore.get("alpha").msgs).toHaveLength(1);
  });

  it("subscribers are notified on append and on newSession", () => {
    let calls = 0;
    const unsub = chatStore.subscribe("alpha", () => { calls++; });
    chatStore.appendUserMessage("alpha", "trigger 1");
    chatStore.appendAssistantMessage("alpha", { role: "assistant", text: "x", ts: Date.now() });
    chatStore.newSession("alpha");
    unsub();
    chatStore.appendUserMessage("alpha", "after unsub — should NOT trigger");
    expect(calls).toBe(3);
  });

  it("subscribers for other agents are not woken up", () => {
    let alphaCalls = 0;
    const unsub = chatStore.subscribe("alpha", () => { alphaCalls++; });
    chatStore.appendUserMessage("beta", "beta only");
    chatStore.appendAssistantMessage("beta", { role: "assistant", text: "x", ts: Date.now() });
    unsub();
    expect(alphaCalls).toBe(0);
  });
});

describe("chatStore — setLastUsage (streaming updates)", () => {
  it("merges partial usage updates", () => {
    chatStore.setLastUsage("alpha", { model: "claude-opus-4-7[1m]" });
    chatStore.setLastUsage("alpha", { inputTokens: 12, outputTokens: 3 });
    chatStore.setLastUsage("alpha", { totalCostUsd: 0.001 });

    const u = chatStore.get("alpha").lastUsage;
    expect(u?.model).toBe("claude-opus-4-7[1m]");
    expect(u?.inputTokens).toBe(12);
    expect(u?.outputTokens).toBe(3);
    expect(u?.totalCostUsd).toBe(0.001);
  });

  it("does not affect sessionUsage (only assistant-message commit does)", () => {
    chatStore.setLastUsage("alpha", { inputTokens: 100 });
    expect(chatStore.get("alpha").sessionUsage.turns).toBe(0);
  });
});

describe("chatStore — SSR/CSR hydration contract (v0.2.9 fix)", () => {
  it("get() returns an empty session synchronously — no localStorage read", () => {
    // The fresh agent must come back empty even if there's hypothetically
    // stale data in localStorage. get() never touches storage.
    const s = chatStore.get("hydration-test-agent");
    expect(s.msgs).toEqual([]);
    expect(s.sessionUsage.turns).toBe(0);
    expect(s.lastUsage).toBeNull();
  });

  it("hydrate() is idempotent — second call is a no-op", () => {
    // First call: no storage in test env, nothing to load. Second call:
    // already marked hydrated, returns immediately. Neither should throw.
    expect(() => {
      chatStore.hydrate("idempotency-test");
      chatStore.hydrate("idempotency-test");
      chatStore.hydrate("idempotency-test");
    }).not.toThrow();
  });

  it("newSession() marks the agent as hydrated so stale storage can't reload it", () => {
    // Append some in-memory state, then newSession clears it. A subsequent
    // hydrate() call must NOT bring data back (defensively, even if the
    // previous test left storage in a weird state).
    chatStore.appendUserMessage("clean-after-new", "should be cleared");
    chatStore.newSession("clean-after-new");
    chatStore.hydrate("clean-after-new");
    expect(chatStore.get("clean-after-new").msgs).toEqual([]);
  });
});
