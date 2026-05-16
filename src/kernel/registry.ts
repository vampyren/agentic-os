// Agent registry: single source of truth for the set of agents the kernel
// knows about. Loads manifests, binds each to a transport instance, exposes
// list/get/health/chat/stream.
//
// The registry is a singleton stashed on globalThis so Next.js hot-reload in
// dev mode doesn't multiply instances.

import { loadManifests, type LoadManifestsOpts } from "./manifest";
import { createSubprocessTransport } from "./transports/subprocess";
import { createStreamJsonTransport } from "./transports/streamJson";
import { bus } from "./bus";
import {
  auditAgentInvoke,
  auditAgentInvokeComplete,
  auditAgentInvokeError,
  classifyAgentError,
  redactArgs,
  sha8,
} from "./audit";
import { startHealthLoop } from "./health";
import { runPostRunUsage } from "./postRunUsage";
import { hasMeaningfulUsage } from "./types";
import type {
  AgentEvent,
  AgentManifest,
  HealthReport,
  StreamOpts,
  Transport,
} from "./types";
import { renderArgsForAudit } from "./spawn";

interface RegisteredAgent {
  manifest: AgentManifest;
  transport: Transport;
}

class Registry {
  private agents = new Map<string, RegisteredAgent>();
  private initPromise: Promise<void> | null = null;

  init(opts: LoadManifestsOpts = {}): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit(opts);
    }
    return this.initPromise;
  }

  private async doInit(opts: LoadManifestsOpts): Promise<void> {
    const manifests = await loadManifests(opts);
    this.agents.clear();
    for (const m of manifests) {
      this.agents.set(m.name, { manifest: m, transport: this.makeTransport(m) });
    }
    bus.emit({
      source: "system",
      kind: "system.registry.loaded",
      payload: { count: this.agents.size, names: [...this.agents.keys()] },
    });

    // Kick off the per-manifest health probe loop. The loop survives
    // HMR via globalThis state in health.ts.
    startHealthLoop(
      [...this.agents.values()].map((a) => ({
        manifest: a.manifest,
        probe: () => a.transport.health(),
      })),
    );
  }

  private makeTransport(m: AgentManifest): Transport {
    switch (m.transport) {
      case "subprocess":
        return createSubprocessTransport(m);
      case "streamJson":
        return createStreamJsonTransport(m);
      default: {
        const _exhaustive: never = m.transport;
        throw new Error(`unknown transport: ${String(_exhaustive)}`);
      }
    }
  }

  list(): AgentManifest[] {
    return [...this.agents.values()].map((a) => a.manifest);
  }

  get(name: string): RegisteredAgent | undefined {
    return this.agents.get(name);
  }

  async health(name: string): Promise<HealthReport> {
    const a = this.agents.get(name);
    if (!a) return { status: "unknown", message: `unknown agent: ${name}`, checkedAt: Date.now() };
    const report = await a.transport.health();
    bus.emit({ source: name, kind: "agent.health", payload: report });
    return report;
  }

  /**
   * Convenience: collects the full text response into a single string.
   * Internally uses stream() so the audit log and bus see the same events.
   */
  async chat(name: string, opts: StreamOpts): Promise<{ text: string; exitCode: number | null; durationMs: number }> {
    let text = "";
    let exitCode: number | null = null;
    let durationMs = 0;
    for await (const evt of this.stream(name, opts)) {
      if (evt.kind === "token") text += evt.text;
      else if (evt.kind === "done") {
        exitCode = evt.exitCode ?? null;
        durationMs = evt.durationMs;
      }
    }
    return { text, exitCode, durationMs };
  }

  /**
   * The canonical agent-invocation path. Emits bus events at start/each-token/
   * complete/error and writes audit log lines on start and complete.
   */
  async *stream(name: string, opts: StreamOpts): AsyncIterable<AgentEvent> {
    const a = this.agents.get(name);
    if (!a) {
      const message = `unknown agent: ${name}`;
      bus.emit({ source: "system", kind: "agent.invoke.error", payload: { agent: name, message } });
      // No raw message in audit; this is a routing failure with no prompt
      // content, but use the same neutral schema as runtime errors.
      await auditAgentInvokeError({
        agent: name,
        errorClass: "transport-error",
        stderrChars: message.length,
      });
      yield { kind: "error", message };
      yield { kind: "done", durationMs: 0, exitCode: -1 };
      return;
    }

    const { manifest, transport } = a;
    const transportConfig = manifest.transportConfig as { bin: string; args: string[] };
    // Build the audit-safe argv view: the {prompt} placeholder maps to
    // [PROMPT_REDACTED], never the real prompt content. The real prompt is
    // passed to the transport directly through opts.prompt below — it never
    // reaches the audit log other than as promptSha256 / promptChars.
    const argsForAudit = renderArgsForAudit(transportConfig.args);

    bus.emit({
      source: name,
      kind: "agent.invoke",
      payload: { promptChars: opts.prompt.length },
    });
    await auditAgentInvoke({
      agent: name,
      transport: manifest.transport,
      bin: transportConfig.bin,
      argsRedacted: redactArgs(argsForAudit),
      prompt: opts.prompt,
    });

    let bytesOut = 0;
    let exitCode: number | null = null;
    let durationMs = 0;
    let errored = false;
    let errorMessage = "";
    // Capture wall start so the catch path can report elapsed-ms instead
    // of epoch-ms (Hermes v0.2.8 review "worth tightening").
    const startedAt = Date.now();
    // Buffer the transport's done event so we can interleave postRunUsage
    // BEFORE done. Canonical run order per docs/SECURITY.md & ADR-0009:
    //   1. token | usage (interleaved as transport emits)
    //   2. error (only on failure)
    //   3. usage (postRunUsage, if any)
    //   4. done                  ← terminal event
    //   5. saved                 ← added by the run endpoint after stream ends
    let pendingDone: AgentEvent | null = null;

    try {
      for await (const evt of transport.stream(opts)) {
        if (evt.kind === "token") {
          bytesOut += evt.text.length;
          bus.emit({ source: name, kind: "agent.token", payload: { chars: evt.text.length } });
          yield evt;
        } else if (evt.kind === "usage") {
          // Drop empty usage at the kernel boundary so the UI never sees
          // {} (Hermes review of v0.2.6 / v0.2.7).
          if (hasMeaningfulUsage(evt.usage)) {
            bus.emit({ source: name, kind: "agent.usage", payload: evt.usage });
            yield evt;
          }
        } else if (evt.kind === "error") {
          errored = true;
          errorMessage = evt.message;
          bus.emit({ source: name, kind: "agent.invoke.error", payload: { message: evt.message.slice(0, 200) } });
          yield evt;
        } else if (evt.kind === "done") {
          // Buffer — emit after postRunUsage so consumers treating `done`
          // as terminal still get the usage event first.
          exitCode = evt.exitCode ?? null;
          durationMs = evt.durationMs;
          pendingDone = evt;
        }
      }
    } catch (e) {
      const message = String(e);
      errored = true;
      errorMessage = message;
      bus.emit({ source: name, kind: "agent.invoke.error", payload: { message: message.slice(0, 200) } });
      yield { kind: "error", message };
      // Was Date.now() (epoch) — fixed in v0.2.10 to report elapsed-ms.
      durationMs = Date.now() - startedAt;
      pendingDone = { kind: "done", durationMs, exitCode: -1 };
    }

    if (errored) {
      // Never pass the raw stderr/error message to the audit log. Classify
      // into a neutral bucket, record length + sha8 for correlation/debug,
      // and the transport name. The full message stays on the bus (which is
      // in-memory) and goes to the UI — but never to JSONL. Per ADR-0009 /
      // SECURITY.md: raw prompt content can appear in stderr (some agent
      // CLIs echo the prompt on error), so the audit path must not trust
      // stderr text.
      await auditAgentInvokeError({
        agent: name,
        errorClass: classifyAgentError({ message: errorMessage, exitCode }),
        exitCode,
        stderrSha8: errorMessage ? sha8(errorMessage) : undefined,
        stderrChars: errorMessage.length,
        transport: manifest.transport,
      });
    }

    // Post-run usage extractor (Hermes etc.) — fail-soft: any error here
    // must NOT mark the agent call as failed. The operator already got
    // their response; usage is bonus telemetry.
    if (!errored && manifest.postRunUsage) {
      try {
        const usage = await runPostRunUsage(manifest.postRunUsage.parser);
        if (hasMeaningfulUsage(usage)) {
          bus.emit({ source: name, kind: "agent.usage", payload: usage });
          yield { kind: "usage", usage: usage! };
        }
      } catch { /* fail-soft */ }
    }

    // Emit the terminal `done` after every other event for this run.
    if (pendingDone) yield pendingDone;
    else yield { kind: "done", durationMs: 0, exitCode: -1 };

    bus.emit({
      source: name,
      kind: "agent.invoke.complete",
      payload: { exitCode, durationMs, bytesOut },
    });
    await auditAgentInvokeComplete({
      agent: name,
      durationMs,
      exitCode,
      bytesOut,
    });
  }
}

const G = globalThis as unknown as { __agenticRegistry?: Registry };
export const registry: Registry = G.__agenticRegistry ?? (G.__agenticRegistry = new Registry());

// Test-only export. Lets tests construct an isolated Registry and inject a
// fake agent (manifest + transport pair) without going through the YAML
// manifest loader. Used by the event-ordering integration test in
// tests/registry-stream-order.test.ts.
export const __TEST__ = {
  newRegistry: () => new Registry(),
  injectAgent(reg: Registry, manifest: AgentManifest, transport: Transport): void {
    // Reach past the private field — vitest sees the same JS object.
    const r = reg as unknown as {
      agents: Map<string, { manifest: AgentManifest; transport: Transport }>;
      initPromise: Promise<void> | null;
    };
    r.agents.set(manifest.name, { manifest, transport });
    r.initPromise = Promise.resolve();    // skip init lookup
  },
};
