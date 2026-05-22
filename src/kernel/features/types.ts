// Feature foundation types (Phase 1C — M1).
//
// A feature is a top-level capability surface of Agentic OS —
// Scheduler, Studio, Kanban, Memory, Workflows. M1 splits a feature's
// STABLE core (FeatureModule) from its EVOLVING UI surface
// (FeatureExposures), so the shell can grow in M2 without churning the
// core contract.
//
// The feature foundation lives in the kernel: it depends only on the
// config schema + capability layer, never on the Next.js app layer.
// Route gating (which needs next/navigation + the app CORS helper)
// lives in src/app/_lib/featureGates.ts instead.

import type { z } from "zod";
import type { CapabilityId } from "../capabilities/types";

export type FeatureId = string;

export type FeatureCategory =
  | "core"
  | "automation"
  | "creative"
  | "productivity"
  | "integration"
  | "orchestration";

// Declared, coarse-grained side effects a feature may perform. Used by
// the operator/UI to reason about a feature's blast radius; it is NOT a
// permission system (per-action permission is enforced elsewhere).
export type FeatureSideEffect =
  | "network"
  | "file-read"
  | "file-write"
  | "process-spawn"
  | "timer"
  | "vault-write"
  | "external-api";

// ── Lifecycle ───────────────────────────────────────────────────────

export type FeatureLifecycleState =
  | "ready"
  | "disabled"
  | "degraded"
  | "unavailable";

export interface FeatureLifecyclePolicy {
  /** Effective enablement when the operator config sets nothing. */
  defaultEnabled: boolean;
  /** Whether the operator is allowed to turn this feature off. */
  canDisable: boolean;
  /** Hide from nav/palette while disabled (default: still visible). */
  hiddenWhenDisabled?: boolean;
  /** Core platform feature — surfaced for UI treatment, not enforcement. */
  core?: boolean;
}

export interface FeatureReason {
  code:
    | "config-disabled"
    | "missing-required-capability"
    | "missing-optional-capability"
    | "missing-connector"
    | "missing-auth"
    | "config-invalid"
    | "health-degraded"
    | "health-down"
    | "runtime-unavailable"
    | "external-system-unavailable";
  severity: "info" | "warn" | "error";
  message: string;
  capabilityId?: CapabilityId;
  connectorId?: string;
}

export interface FeatureRuntimeStatus {
  state: FeatureLifecycleState;
  visibility: "visible" | "hidden";
  reasons: FeatureReason[];
}

// ── Health ──────────────────────────────────────────────────────────

export interface FeatureHealth {
  status: "ok" | "degraded" | "unavailable";
  message?: string;
  /** Required capabilities with no enabled provider — drives `degraded`. */
  missingCapabilities?: CapabilityId[];
}

// ── Feature core ────────────────────────────────────────────────────

export interface FeatureModule<TConfig = unknown> {
  id: FeatureId;
  title: string;
  description: string;
  category: FeatureCategory;

  lifecycle: FeatureLifecyclePolicy;

  // Feature-internal config. `schema` parses the operator's persisted
  // config block; `defaults` is the value used when the block is
  // absent. NEITHER is UI-safe — the projection strips both.
  config: {
    // Input is `unknown` so a schema with `.default(...)` (whose parse
    // input is partial/optional) still satisfies the contract.
    schema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
    defaults: TConfig;
  };

  // Capabilities the feature needs (required) or can use (optional).
  // CapabilityId is the kernel's existing hard enum; M1 features that
  // need no connectors leave these empty.
  requiredCapabilities?: CapabilityId[];
  optionalCapabilities?: CapabilityId[];

  sideEffects: ReadonlyArray<FeatureSideEffect>;

  // Forward-looking, not exercised by M1's Scheduler. Raw paths here
  // are NOT UI-safe; the projection strips the whole block.
  vault?: {
    read?: boolean;
    allowedWriteRoots?: string[];
  };
  artifacts?: {
    allowedRoots?: string[];
    mimeAllowlist?: string[];
  };

  // Optional feature-supplied health probe. A function reference — the
  // projection strips it.
  health?: () => Promise<FeatureHealth>;
}

// ── UI exposures ────────────────────────────────────────────────────
//
// Everything below is UI-safe by construction: labels, hrefs, icon
// keys, ordering. No secrets, no filesystem paths, no functions.

export interface NavExposure {
  id: string;
  label: string;
  href: string;
  iconKey: string;
  order: number;
  group?: "platform" | "feature" | "admin";
  visibility?: "always" | "when-ready" | "when-enabled";
}

export interface CommandExposure {
  id: string;
  label: string;
  keywords?: string[];
  action:
    | { type: "navigate"; href: string }
    | { type: "start-run"; runKind: string }
    | { type: "open-panel"; panelKey: string };
  visibility?: "always" | "when-ready" | "when-degraded-or-better";
}

export interface DashboardCardExposure {
  id: string;
  componentKey: string;
  order: number;
  span?: 1 | 2;
}

export interface SettingsPanelExposure {
  componentKey: string;
  summary?: string;
}

export interface WorkspacePanelExposure {
  id: string;
  componentKey: string;
  title: string;
}

export interface FeatureExposures {
  featureId: FeatureId;
  nav?: NavExposure[];
  commands?: CommandExposure[];
  dashboardCards?: DashboardCardExposure[];
  settingsPanel?: SettingsPanelExposure;
  workspacePanels?: WorkspacePanelExposure[];
}
