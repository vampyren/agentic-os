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
  redactArgs,
} from "./audit";
import { startHealthLoop } from "./health";
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
      await auditAgentInvokeError({ agent: name, message });
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

    try {
      for await (const evt of transport.stream(opts)) {
        if (evt.kind === "token") {
          bytesOut += evt.text.length;
          bus.emit({ source: name, kind: "agent.token", payload: { chars: evt.text.length } });
        } else if (evt.kind === "usage") {
          bus.emit({ source: name, kind: "agent.usage", payload: evt.usage });
        } else if (evt.kind === "error") {
          errored = true;
          errorMessage = evt.message;
          bus.emit({ source: name, kind: "agent.invoke.error", payload: { message: evt.message.slice(0, 200) } });
        } else if (evt.kind === "done") {
          exitCode = evt.exitCode ?? null;
          durationMs = evt.durationMs;
        }
        yield evt;
      }
    } catch (e) {
      const message = String(e);
      errored = true;
      errorMessage = message;
      bus.emit({ source: name, kind: "agent.invoke.error", payload: { message: message.slice(0, 200) } });
      yield { kind: "error", message };
      yield { kind: "done", durationMs: Date.now(), exitCode: -1 };
    }

    if (errored) {
      await auditAgentInvokeError({ agent: name, message: errorMessage.slice(0, 500) });
    }
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
