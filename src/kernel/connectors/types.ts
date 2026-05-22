// Connector layer types (M4a — connector runtime).
//
// THREE distinct identities (spec §5 / B2), never blurred:
//   ConnectorFamilyDefinition.id  — implementation family, in CODE.
//   a config.connectors[] key     — operator connector INSTANCE; this is the
//                                   `connectorId` used everywhere (runs,
//                                   external_refs, audit, APIs, the context).
//   ConnectorPreset.id            — catalog seed (M4a-3a).
//
// A family is one definition in code; an instance pairs a family with operator
// settings + server-resolved auth. The ConnectorRuntime (runtime.ts) builds
// the invocable instance; the Capability Router dispatches to it.

import type { z } from "zod";
import type { CapabilityId } from "../capabilities/types";

export type ConnectorTypeFamily = "cli-acp-agent" | "openai-compatible-llm";
//  oauth-mediated-llm | native-vendor-api — post-M4a.

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

// Trust gates future permission prompts. An operator override may only move
// trust DOWN (community / untrusted), never up (spec §5, req 7 / B8).
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

/** The fixed neutral errorCode registry for connector validation (v8 §5.4). */
export type ConnectorErrorCode =
  | "auth-failed"
  | "auth-missing"
  | "rate-limited"
  | "network-unreachable"
  | "config-invalid"
  | "capability-not-supported"
  | "capability-unavailable"
  | "external-system-unavailable"
  | "binary-not-found"
  | "blocked-network"
  | "unknown";

/** Result of a connector test (spec §5 / v8 §5.4). */
export interface ConnectorValidation {
  status: "valid" | "invalid" | "unreachable" | "misconfigured" | "unknown";
  errorCode?: ConnectorErrorCode;
  /** Neutral diagnostic — never a secret, raw path, or provider token. */
  message?: string;
  testedAt: string;
  durationMs: number;
}

/** The auth contract a family declares. Env-only in M4a (req 5 — named type). */
export interface ConnectorAuth {
  required: boolean;
  supportedRefs: Array<"env">;
}

/**
 * The server-side context a connector's invoke()/testConnection() receives.
 * `connectorId` is always the INSTANCE id. `secret` (when present) is the
 * resolved auth value — server-side only, never logged or returned.
 *
 * `settings` is typed `unknown`: the runtime already validated it against the
 * family's `settingsSchema` (buildConnectorContext), and a registry of mixed
 * families cannot carry per-family generics. A connector narrows `settings`
 * to its own type at the top of `invoke` / `testConnection`.
 */
export interface ConnectorInvokeContext {
  connectorId: string;
  typeFamily: ConnectorTypeFamily;
  settings: unknown;
  secret?: string;
  /** Connectors SHOULD respect this; router-level timeout is post-M4a (req 6). */
  signal?: AbortSignal;
}

/**
 * A connector type family — registered in CODE. `capabilities` is the
 * MAXIMUM set any instance of the family may expose; an instance narrows it
 * (runtime.ts computes the effective set).
 *
 * Non-generic so the registry can hold families with different settings
 * shapes; `settingsSchema` is the family's real Zod schema (it strictly
 * re-parses an instance's `settings` in the runtime).
 */
export interface ConnectorFamilyDefinition {
  id: ConnectorTypeFamily;
  title: string;
  kind: ConnectorKind;
  transport: ConnectorTransport;
  capabilities: CapabilityId[];
  sideEffects: ReadonlyArray<ConnectorSideEffect>;
  defaultTrust: ConnectorTrust;
  settingsSchema: z.ZodTypeAny;
  defaultSettings: unknown;
  auth: ConnectorAuth;
  health?: (ctx: ConnectorInvokeContext) => Promise<ConnectorHealth>;
  testConnection?: (
    ctx: ConnectorInvokeContext,
    opts?: { signal?: AbortSignal; runId?: string },
  ) => Promise<ConnectorValidation>;
  invoke: (
    ctx: ConnectorInvokeContext,
    capability: CapabilityId,
    input: unknown,
  ) => Promise<ConnectorResult>;
}
