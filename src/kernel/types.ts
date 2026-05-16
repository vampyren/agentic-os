// Shared kernel types. The registry and every transport consume these.
// See docs/AGENT-MANIFEST.md for the manifest schema this maps to.

export type TransportKind = "subprocess" | "streamJson";

export interface SubprocessTransportConfig {
  bin: string;
  args: string[];                       // "{prompt}" tokens get replaced at runtime
  timeoutMs?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface StreamJsonTransportConfig {
  bin: string;
  args: string[];                       // "{prompt}" tokens get replaced at runtime
  cwd?: string;
}

export interface HealthProbeConfig {
  type: "command";
  command: string[];
  timeoutMs?: number;                   // default 3000
  intervalSec?: number;                 // default 300 (used in Phase 1B's probe loop)
}

export interface AgentManifest {
  name: string;
  displayName: string;
  description?: string;
  transport: TransportKind;
  transportConfig: SubprocessTransportConfig | StreamJsonTransportConfig;
  capabilities?: { chat?: boolean; streamingChat?: boolean };
  healthProbe?: HealthProbeConfig;
}

export interface HealthReport {
  status: "live" | "degraded" | "offline" | "unknown";
  version?: string;
  message?: string;
  checkedAt: number;
}

// Events produced by a single agent stream() call.
export type AgentEvent =
  | { kind: "token"; text: string }
  | { kind: "error"; message: string }
  | { kind: "done"; durationMs: number; exitCode?: number | null };

export interface StreamOpts {
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
}

export interface Transport {
  health(): Promise<HealthReport>;
  stream(opts: StreamOpts): AsyncIterable<AgentEvent>;
}

// Bus envelope. Every real-time signal in the kernel (agent invocations, vault
// writes, future scheduler events) flows through one bus → one SSE endpoint.
export interface BusEvent {
  id: string;
  ts: number;
  source: string;                       // agent name | "system" | "vault" | "scheduler"
  kind: string;                         // see audit.ts for the canonical set
  payload?: unknown;
}

export interface AppConfig {
  vault: { root: string };
  agents: { default?: string };
}
