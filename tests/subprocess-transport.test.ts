// Subprocess transport happy-path: spawn /bin/echo with a templated prompt,
// confirm we see a token event with the echoed text and a clean done event.

import { describe, it, expect } from "vitest";
import { createSubprocessTransport } from "../src/kernel/transports/subprocess";
import type { AgentEvent, AgentManifest } from "../src/kernel/types";

function makeManifest(): AgentManifest {
  return {
    name: "echo-test",
    displayName: "Echo",
    transport: "subprocess",
    transportConfig: {
      bin: "/bin/echo",
      args: ["hello", "{prompt}"],
      timeoutMs: 5000,
      cwd: "/tmp",
    },
    healthProbe: {
      type: "command",
      command: ["/bin/echo", "alive"],
      timeoutMs: 2000,
    },
  };
}

describe("subprocess transport", () => {
  it("streams a token event and a done event on success", async () => {
    const t = createSubprocessTransport(makeManifest());
    const events: AgentEvent[] = [];
    for await (const e of t.stream({ prompt: "world", cwd: "/tmp" })) {
      events.push(e);
    }

    const token = events.find((e) => e.kind === "token");
    const done = events.find((e) => e.kind === "done");
    expect(token).toBeDefined();
    if (token?.kind === "token") {
      expect(token.text).toContain("hello world");
    }
    expect(done).toBeDefined();
    if (done?.kind === "done") {
      expect(done.exitCode).toBe(0);
      expect(done.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports health as live for a working binary", async () => {
    const t = createSubprocessTransport(makeManifest());
    const report = await t.health();
    expect(report.status).toBe("live");
  });

  it("reports offline for a missing binary", async () => {
    const t = createSubprocessTransport({
      ...makeManifest(),
      transportConfig: {
        bin: "/nonexistent-binary-xyz",
        args: ["{prompt}"],
        cwd: "/tmp",
      },
      healthProbe: {
        type: "command",
        command: ["/nonexistent-binary-xyz"],
        timeoutMs: 1000,
      },
    });
    const report = await t.health();
    expect(report.status).toBe("offline");
  });
});
