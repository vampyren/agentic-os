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

export interface PostRunUsageConfig {
  parser: "hermes-session-export";
}

export interface AgentManifest {
  name: string;
  displayName: string;
  description?: string;
  transport: TransportKind;
  transportConfig: SubprocessTransportConfig | StreamJsonTransportConfig;
  capabilities?: { chat?: boolean; streamingChat?: boolean };
  healthProbe?: HealthProbeConfig;
  postRunUsage?: PostRunUsageConfig;
}

export interface HealthReport {
  status: "live" | "degraded" | "offline" | "unknown";
  version?: string;
  message?: string;
  checkedAt: number;
}

// Usage stats returned by some transports (Claude Code stream-json definitely;
// HTTP cloud providers in Phase 2A). Hermes subprocess has no per-call usage.
export interface AgentUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
}

/**
 * Whether a usage object carries any signal worth surfacing. An empty object
 * `{}` or `undefined` returns false — important because `{}` is truthy in JS
 * and would otherwise pass naive `if (usage)` guards, bumping session-turn
 * counters with no real numbers (Hermes review of v0.2.6).
 *
 * Model-only updates DO count as meaningful — the model name is useful even
 * before any token counts arrive (e.g. the `system.init` event in Claude's
 * stream-json fires the model before the first content delta).
 */
export function hasMeaningfulUsage(u: AgentUsage | undefined | null): boolean {
  if (!u) return false;
  return Boolean(
    (u.inputTokens && u.inputTokens > 0) ||
    (u.outputTokens && u.outputTokens > 0) ||
    (u.cacheReadInputTokens && u.cacheReadInputTokens > 0) ||
    (u.cacheCreationInputTokens && u.cacheCreationInputTokens > 0) ||
    (typeof u.totalCostUsd === "number" && u.totalCostUsd >= 0 && u.totalCostUsd !== 0) ||
    // .trim() so "   " or "\t\n" doesn't pass as a meaningful model name
    // (Hermes v0.2.8 review "worth tightening").
    (typeof u.model === "string" && u.model.trim().length > 0),
  );
}

// Events produced by a single agent stream() call.
export type AgentEvent =
  | { kind: "token"; text: string }
  | { kind: "usage"; usage: AgentUsage }
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
