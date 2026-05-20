# ADR-0010 — Phase 1C registry triad: features, connectors, capabilities

**Status:** Accepted
**Date:** 2026-05-20

## Context

Phase 1C is the "integration spine" — the layer that lets future systems
(Studio, Kanban, NotebookLM, Gemini, Grok, MCP servers, missions) plug in
as registrations rather than kernel changes. Before 1C the kernel knew
only about *agents* (ADR-0002). That single registry does not generalise:
a feature is not an agent, a connector is not an agent, and a capability
is an abstraction over connectors.

Two design reviews (Claude + ChatGPT, consolidated in
`PHASE-1C-DESIGN-CONSOLIDATED-v2.md`) agreed the spine needs three
distinct registration concepts, not one.

## Decision

Phase 1C introduces three registries — the **registry triad** — alongside
the existing agent registry:

- **Feature Registry** (`src/kernel/features/`) — top-level capability
  surfaces of Agentic OS (Scheduler, Studio, Kanban, Memory). A
  `FeatureModule` declares `id`, `category`, `sideEffects`,
  `requiredCapabilities`, optional `nav`, optional `health()`.
- **Connector Registry** (`src/kernel/connectors/`) — abstract
  integrations with external systems. A `ConnectorDefinition` declares
  `kind`, `transport`, `capabilities`, `sideEffects`, `trust`, optional
  `health()` / `invoke()`. Connector *definitions* are registered in
  code; per-connector operator *settings* (enable / `authRef` / trust
  override) live in `config.connectors`.
- **Capability Router** (`src/kernel/capabilities/`) — the indirection
  layer. Features call **capabilities** (`CapabilityId`, a hard Zod
  enum), never connectors by brand. The router resolves a capability to
  an enabled connector that declares it and delegates.

Each registry mirrors the agent-registry pattern (ADR-0002): an
in-memory class, a `globalThis` singleton that survives Next.js
hot-reload, a `__TEST__` seam for isolated test instances, explicit
in-code registration (no filesystem discovery).

Phase 1C M2 ships these as **types + schemas + mechanisms only**: zero
production connectors, zero production features registered; the router
is a stub whose resolution logic is real but resolves to "no provider".

Invariants:
- Features never import other features.
- Features never call connectors directly — only through the router.
- Connectors never call other connectors.
- Adding a system is a registration, not a kernel change.

## Consequences

**Positive**
- New systems (Gemini, NotebookLM, …) plug in by implementing a
  registry interface — the kernel does not change.
- "Feature enabled ≠ connector authorised" falls out naturally: a
  feature is visible while its connector is unconfigured/`degraded`.
- The capability indirection keeps connectors swappable — a feature
  asking for `media.image.generate` does not care which connector wins.

**Negative**
- Three registries plus the agent registry is more surface than one.
  Justified: each models a genuinely different concept.

**Neutral**
- The agent registry (ADR-0002) is unchanged. A future ADR may bridge
  agents into the connector model; Phase 1C does not.

## Alternatives considered

- **One generic registry for everything.** Rejected — a feature, a
  connector, and a capability have different shapes and lifecycles.
- **Features call connectors directly.** Rejected — couples features to
  connector brands and defeats swappability.
- **Filesystem discovery of connectors/features.** Rejected — explicit
  in-code registration matches the agent-manifest pattern, keeps the
  loaded set visible, and makes test mocking trivial.

## References

- ADR-0002 — agent registry and Transport interface.
- ADR-0012 — capability router neutral results.
- `PHASE-1C-DESIGN-CONSOLIDATED-v2.md` §5 (five-layer model), §7.
