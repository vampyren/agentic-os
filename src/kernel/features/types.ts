// Feature layer types (Phase 1C — Milestone 2).
//
// A feature is a top-level capability surface of Agentic OS —
// Scheduler, Studio, Kanban, Memory, Workflows. Each feature declares
// what it needs (requiredCapabilities) so the runtime can mark it
// `degraded` when no connector provides a needed capability — without
// the feature's own code having to check.
//
// M2 registers ZERO production features. The registry + the
// capability-derived health helper are what M2 delivers; in-test
// fakes exercise them.

import type { CapabilityId } from "../capabilities/types";

export type FeatureId = string;

export type FeatureCategory =
  | "core"
  | "automation"
  | "creative"
  | "productivity"
  | "integration";

export type FeatureSideEffect =
  | "none"
  | "vault-read"
  | "vault-write"
  | "external-api"
  | "local-process"
  | "network"
  | "scheduler";

export interface FeatureNav {
  label: string;
  href: string;
  icon: string;
  order: number;
}

export interface FeatureHealth {
  status: "ok" | "degraded" | "unavailable";
  message?: string;
  /** Required capabilities with no enabled provider — drives `degraded`. */
  missingCapabilities?: CapabilityId[];
}

export interface FeatureModule {
  id: FeatureId;
  title: string;
  description: string;
  category: FeatureCategory;
  sideEffects: ReadonlyArray<FeatureSideEffect>;
  /** Capabilities the feature needs to function fully. */
  requiredCapabilities?: CapabilityId[];
  nav?: FeatureNav;
  /** Optional feature-specific health probe (overrides the derived one). */
  health?: () => Promise<FeatureHealth>;
}
