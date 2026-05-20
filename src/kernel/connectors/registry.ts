// Connector registry (Phase 1C — Milestone 2).
//
// In-memory registry of ConnectorDefinitions, registered explicitly in
// code (mirrors the agent-manifest registry pattern in
// src/kernel/registry.ts — no filesystem discovery). M2 registers no
// production connectors; the registry ships empty. A globalThis
// singleton survives Next.js hot-reload; tests build isolated
// instances via __TEST__.newRegistry().

import type { ConnectorDefinition } from "./types";

class ConnectorRegistry {
  private connectors = new Map<string, ConnectorDefinition>();

  /** Register a connector definition. Throws on a duplicate id. */
  register(def: ConnectorDefinition): void {
    if (this.connectors.has(def.id)) {
      throw new Error(`connector already registered: ${def.id}`);
    }
    this.connectors.set(def.id, def);
  }

  /** Look up a connector by id. Unknown id → undefined (not an error). */
  get(id: string): ConnectorDefinition | undefined {
    return this.connectors.get(id);
  }

  /** All registered connector definitions. */
  list(): ConnectorDefinition[] {
    return [...this.connectors.values()];
  }
}

export type { ConnectorRegistry };

// Singleton on globalThis — same pattern as registry.ts / bus.ts so a
// Next.js hot-reload doesn't spawn a second registry.
const G = globalThis as unknown as {
  __agenticConnectorRegistry?: ConnectorRegistry;
};
export const connectorRegistry: ConnectorRegistry =
  G.__agenticConnectorRegistry
  ?? (G.__agenticConnectorRegistry = new ConnectorRegistry());

// Test seam — an isolated registry so unit tests don't accumulate
// state on the process-wide singleton.
export const __TEST__ = {
  newRegistry: (): ConnectorRegistry => new ConnectorRegistry(),
};
