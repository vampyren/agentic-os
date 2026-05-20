// Capability layer types (Phase 1C — Milestone 2).
//
// A "capability" is an abstract operation a feature can ask for —
// `media.image.generate`, `chat.generate`, etc. Features call
// capabilities through the Capability Router; they never reach for a
// connector by brand. The router resolves a capability to an enabled
// connector that declares it.
//
// M2 ships the router as a STUB: real resolution logic, but no
// production connector is registered, so a real invoke resolves to
// "no provider / skipped". The hard CapabilityId enum is the canonical
// set for Phase 1C — adding a capability is a one-line change here.

import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types";

// Hard enum — every capability Phase 1C knows about. `vault.note.write`
// is included now but has NO provider until M4's constrained writer
// lands; the router reports it as no-provider until then, and it must
// route through the same constrained writer as MissionOutput
// { kind: "vault-note" } — never a second vault-write path.
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
  "kanban.task.create",
  "vault.note.write",
]);

export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

/**
 * Result of a router.invoke() call.
 *
 * NEUTRAL-BY-CONTRACT: `message` / `errorCode` / `metadata` on a
 * skipped or failed result must never carry a secret, an authRef
 * value, raw input, command args, env, or a private filesystem path.
 * The router constructs only generic strings; a connector's own
 * passed-through metadata is the connector's responsibility.
 */
export interface CapabilityInvokeResult<T = unknown> {
  status: "success" | "failed" | "skipped";
  capability: CapabilityId;
  /** The connector that handled (or was selected for) the invoke. */
  connectorId?: string;
  output?: T;
  errorCode?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The Capability Router. Features depend on THIS, never on connectors
 * directly. M2 implementation is a stub (see capabilities/router.ts).
 */
export interface CapabilityRouter {
  invoke<T = unknown>(
    capability: CapabilityId,
    input: unknown,
    opts?: { connectorId?: string; signal?: AbortSignal },
  ): Promise<CapabilityInvokeResult<T>>;

  /** Enabled connectors that declare `capability`. */
  list(capability: CapabilityId): ConnectorDefinition[];

  /** True when at least one enabled connector declares `capability`. */
  has(capability: CapabilityId): boolean;
}
