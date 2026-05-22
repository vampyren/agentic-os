// Connector family registry (M4a — connector runtime).
//
// In-memory registry of ConnectorFamilyDefinitions, keyed by the type-family
// id and registered explicitly in CODE (no filesystem discovery — mirrors the
// agent-manifest registry pattern). Operator connector INSTANCES live in
// config (connectors/schema.ts); the runtime pairs an instance with its
// family. A globalThis singleton survives Next.js hot-reload; tests build
// isolated instances via __TEST__.newRegistry().
//
// M4a-1 registers no families; the first families land in M4a-2 / M4a-3a.

import type { ConnectorFamilyDefinition, ConnectorTypeFamily } from "./types";

class ConnectorRegistry {
  private families = new Map<ConnectorTypeFamily, ConnectorFamilyDefinition>();

  /** Register a connector family definition. Throws on a duplicate id. */
  register(family: ConnectorFamilyDefinition): void {
    if (this.families.has(family.id)) {
      throw new Error(`connector family already registered: ${family.id}`);
    }
    this.families.set(family.id, family);
  }

  /** Look up a family by id. Unknown id → undefined (not an error). */
  get(id: ConnectorTypeFamily): ConnectorFamilyDefinition | undefined {
    return this.families.get(id);
  }

  /** All registered connector families. */
  list(): ConnectorFamilyDefinition[] {
    return [...this.families.values()];
  }
}

export type { ConnectorRegistry };

// Singleton on globalThis — same pattern as the agent registry / bus so a
// Next.js hot-reload doesn't spawn a second registry.
const G = globalThis as unknown as {
  __agenticConnectorRegistry?: ConnectorRegistry;
};
export const connectorRegistry: ConnectorRegistry =
  G.__agenticConnectorRegistry
  ?? (G.__agenticConnectorRegistry = new ConnectorRegistry());

// Test seam — an isolated registry so unit tests don't accumulate state on
// the process-wide singleton.
export const __TEST__ = {
  newRegistry: (): ConnectorRegistry => new ConnectorRegistry(),
};
