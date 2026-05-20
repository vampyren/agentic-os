// Connector layer types (Phase 1C — Milestone 2).
//
// A connector is an abstract integration with an external system —
// an AI provider, a managed agent, a knowledge system, a media
// generator, etc. Connectors are registered in CODE (a
// ConnectorDefinition), while per-connector operator settings
// (enabled / authRef / trust override) live in config (see
// connectors/schema.ts). The Capability Router resolves a capability
// to an enabled connector that declares it.
//
// M2 registers ZERO production connectors. Definitions are exercised
// only by in-test fakes; the registry + router mechanisms are what
// M2 actually delivers.

import type { CapabilityId } from "../capabilities/types";

export type ConnectorKind =
  | "ai-provider"
  | "managed-agent"
  | "knowledge-system"
  | "media-generator"
  | "task-system"
  | "local-tool";

export type ConnectorTransport =
  | "http"
  | "mcp"
  | "subprocess"
  | "streamJson"
  | "sdk"
  | "manual";

// Trust gates future permission prompts (declarative in Phase 1C).
//   first-party — Agentic OS's own / vetted integrations
//   community   — unofficial bridges; prompt before use
//   untrusted   — explicit per-call authorisation required
export type ConnectorTrust = "first-party" | "community" | "untrusted";

export type ConnectorSideEffect =
  | "external-api"
  | "local-process"
  | "network"
  | "code-execution"
  | "vault-read"
  | "vault-write";

export interface ConnectorHealth {
  status: "live" | "degraded" | "offline" | "unknown";
  message?: string;
  checkedAt: number;
}

/** Shape a connector's `invoke` returns. */
export interface ConnectorResult<T = unknown> {
  status: "success" | "failed";
  output?: T;
  errorCode?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A connector definition — registered in code. `capabilities` is a
 * flat CapabilityId[] for M2 (the richer per-operation
 * CapabilityDefinition[] from the design doc is deferred until
 * connectors gain real `invoke` implementations).
 *
 * `health` and `invoke` are optional: M2 ships no production
 * connector with a working `invoke`, and the router treats a missing
 * `invoke` as "no-op / skipped".
 */
export interface ConnectorDefinition {
  id: string;
  title: string;
  kind: ConnectorKind;
  transport: ConnectorTransport;
  capabilities: CapabilityId[];
  sideEffects: ReadonlyArray<ConnectorSideEffect>;
  trust: ConnectorTrust;
  health?: () => Promise<ConnectorHealth>;
  invoke?: (capability: CapabilityId, input: unknown) => Promise<ConnectorResult>;
}
