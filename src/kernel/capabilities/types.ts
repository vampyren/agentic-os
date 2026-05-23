// Capability layer types (M4a — connector runtime).
//
// A "capability" is an abstract operation a feature can ask for —
// `chat.generate`, `agent.run`, etc. Features call capabilities through the
// Capability Router; they never reach for a connector by brand. The router
// resolves a capability to an enabled connector INSTANCE whose effective
// capability set includes it.

import { z } from "zod";
import type { ConnectorTrust, ConnectorTypeFamily } from "../connectors/types";
import type { RouterErrorCode } from "./errorCodes";

// Hard enum — every well-known capability. Adding one is a core type change
// (+ an ADR). `vault.note.write` and `kanban.task.create` are declared but
// unimplemented in M4a. The three read-only `kanban.*` ids land in M4a-4.
export const CapabilityIdSchema = z.enum([
  "chat.generate",
  "agent.run",
  "vision.analyze",
  "knowledge.query",
  "knowledge.source.add",
  "media.image.generate",
  "media.video.generate",
  "code.execute",
  "code.modify",
  "web.fetch",
  "sandbox.files",
  // Kanban — read-only set landed in M4a-4 (Hermes-CLI-backed). The write
  // capability `kanban.task.create` is declared for the eventual write path;
  // M4a is read-only, so no connector implements it yet.
  "kanban.board.list",
  "kanban.task.list",
  "kanban.task.show",
  "kanban.task.create",
  "vault.note.write",
]);

export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

/**
 * Result of a router.invoke() call.
 *
 * NEUTRAL-BY-CONTRACT: `message` / `errorCode` / `metadata` on a skipped or
 * failed result never carry a secret, an authRef value, raw input, command
 * args, env, or a private filesystem path. The router constructs only generic
 * strings and a SANITIZED errorCode (B13).
 *
 * `errorCode` is typed as the closed RouterErrorCode union (M4a-5 PR AB,
 * spec §9): a CapabilityRouter implementation cannot emit an arbitrary
 * string; consumers can switch over a finite set. ConnectorErrorCode values
 * (e.g. `auth-failed`, `blocked-network`) NEVER cross through here — the
 * router collapses them to `connector-returned-failure`.
 */
export interface CapabilityInvokeResult<T = unknown> {
  status: "success" | "failed" | "skipped";
  capability: CapabilityId;
  /** The connector INSTANCE id that handled (or was selected for) the invoke. */
  connectorId?: string;
  output?: T;
  errorCode?: RouterErrorCode;
  message?: string;
  metadata?: Record<string, unknown>;
}

/** A router-facing summary of one enabled connector instance. */
export interface ConnectorInstanceSummary {
  connectorId: string;
  typeFamily: ConnectorTypeFamily;
  /** The instance's EFFECTIVE capability set (family max ∩ instance narrow). */
  capabilities: CapabilityId[];
  trust: ConnectorTrust;
}

/**
 * The Capability Router. Features depend on THIS, never on connectors
 * directly.
 */
export interface CapabilityRouter {
  invoke<T = unknown>(
    capability: CapabilityId,
    input: unknown,
    opts?: { connectorId?: string; signal?: AbortSignal },
  ): Promise<CapabilityInvokeResult<T>>;

  /** Enabled connector instances whose effective set includes `capability`. */
  list(capability: CapabilityId): ConnectorInstanceSummary[];

  /** True when at least one enabled instance can serve `capability`. */
  has(capability: CapabilityId): boolean;
}
