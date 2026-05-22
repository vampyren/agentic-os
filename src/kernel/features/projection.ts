// UI-safe feature projection (Phase 1C — M1).
//
// The browser must never see a feature's config schema (a Zod object),
// its config defaults (may carry secrets), its health probe (a
// function), any raw filesystem path from `vault` / `artifacts`, or any
// free-text message a feature's health probe produced.
//
// This projection is a DEEP ALLOWLIST. Every field that crosses to the
// client is named and copied explicitly — at the top level AND inside
// `status` and `exposures`. Nothing is passed through wholesale, so a
// property attached to a status / reason / exposure object at runtime
// (a stray field, a secret, an arbitrary object) cannot ride along.
// Adding a sensitive field to any of these types later does not
// silently widen the surface — it stays off the wire until named here.

import type { ResolvedFeature } from "./resolver";
import type {
  CommandExposure,
  DashboardCardExposure,
  FeatureCategory,
  FeatureExposures,
  FeatureId,
  FeatureReason,
  FeatureRuntimeStatus,
  NavExposure,
  SettingsPanelExposure,
  WorkspacePanelExposure,
} from "./types";

export interface UiSafeFeature {
  id: FeatureId;
  title: string;
  description: string;
  category: FeatureCategory;
  /**
   * Whether the operator may turn this feature off — copied from
   * `lifecycle.canDisable`. A plain boolean, UI-safe; the M2 settings
   * page reads it to decide whether to offer a disable affordance.
   * Additive evolution of the M1 projection contract (not a fix).
   */
  canDisable: boolean;
  status: FeatureRuntimeStatus;
  exposures: FeatureExposures;
}

// A reason's human-readable text is DERIVED from its `code` — a closed
// enum — and never copied from `reason.message`. The resolver fills
// `message` from a feature-supplied health probe (`FeatureHealth.message`,
// untrusted free text) or by interpolating ids into a template; deriving
// here guarantees no raw health message or interpolated value reaches
// the browser. An unknown code falls back to a generic line.
const REASON_MESSAGE: Record<FeatureReason["code"], string> = {
  "config-disabled": "Feature is disabled in the operator config.",
  "missing-required-capability":
    "A required capability has no enabled provider.",
  "missing-optional-capability":
    "An optional capability has no enabled provider.",
  "missing-connector": "A required connector is not configured.",
  "missing-auth": "A required connector is not authenticated.",
  "config-invalid": "The feature configuration is invalid.",
  "health-degraded": "The feature reports degraded health.",
  "health-down": "The feature reports it is unavailable.",
  "runtime-unavailable": "The feature runtime is unavailable.",
  "external-system-unavailable": "An external system is unavailable.",
};

/**
 * Project one reason. `code` and `severity` are closed enums;
 * `capabilityId` is the kernel's `CapabilityId` enum and `connectorId`
 * a registry key — all identifiers, not free text. `message` is
 * re-derived from `code`, never carried through.
 */
function projectReason(reason: FeatureReason): FeatureReason {
  const safe: FeatureReason = {
    code: reason.code,
    severity: reason.severity,
    message: REASON_MESSAGE[reason.code] ?? "The feature is not ready.",
  };
  if (reason.capabilityId !== undefined) safe.capabilityId = reason.capabilityId;
  if (reason.connectorId !== undefined) safe.connectorId = reason.connectorId;
  return safe;
}

function projectStatus(status: FeatureRuntimeStatus): FeatureRuntimeStatus {
  return {
    state: status.state,
    visibility: status.visibility,
    reasons: status.reasons.map(projectReason),
  };
}

function projectNav(nav: NavExposure): NavExposure {
  const safe: NavExposure = {
    id: nav.id,
    label: nav.label,
    href: nav.href,
    iconKey: nav.iconKey,
    order: nav.order,
  };
  if (nav.group !== undefined) safe.group = nav.group;
  if (nav.visibility !== undefined) safe.visibility = nav.visibility;
  return safe;
}

/**
 * Project a command action by its discriminant. An unrecognised
 * `type` yields `undefined` — the caller then drops the whole command,
 * so an arbitrary action object cannot cross.
 */
function projectCommandAction(
  action: CommandExposure["action"],
): CommandExposure["action"] | undefined {
  switch (action.type) {
    case "navigate":
      return { type: "navigate", href: action.href };
    case "start-run":
      return { type: "start-run", runKind: action.runKind };
    case "open-panel":
      return { type: "open-panel", panelKey: action.panelKey };
    default:
      return undefined;
  }
}

function projectCommand(cmd: CommandExposure): CommandExposure | undefined {
  const action = projectCommandAction(cmd.action);
  if (!action) return undefined;
  const safe: CommandExposure = { id: cmd.id, label: cmd.label, action };
  if (cmd.keywords !== undefined) {
    safe.keywords = cmd.keywords.filter((k) => typeof k === "string");
  }
  if (cmd.visibility !== undefined) safe.visibility = cmd.visibility;
  return safe;
}

function projectDashboardCard(
  card: DashboardCardExposure,
): DashboardCardExposure {
  const safe: DashboardCardExposure = {
    id: card.id,
    componentKey: card.componentKey,
    order: card.order,
  };
  if (card.span !== undefined) safe.span = card.span;
  return safe;
}

function projectSettingsPanel(
  panel: SettingsPanelExposure,
): SettingsPanelExposure {
  const safe: SettingsPanelExposure = { componentKey: panel.componentKey };
  if (panel.summary !== undefined) safe.summary = panel.summary;
  return safe;
}

function projectWorkspacePanel(
  panel: WorkspacePanelExposure,
): WorkspacePanelExposure {
  return {
    id: panel.id,
    componentKey: panel.componentKey,
    title: panel.title,
  };
}

function projectExposures(exposures: FeatureExposures): FeatureExposures {
  const safe: FeatureExposures = { featureId: exposures.featureId };
  if (exposures.nav) safe.nav = exposures.nav.map(projectNav);
  if (exposures.commands) {
    safe.commands = exposures.commands
      .map(projectCommand)
      .filter((c): c is CommandExposure => c !== undefined);
  }
  if (exposures.dashboardCards) {
    safe.dashboardCards = exposures.dashboardCards.map(projectDashboardCard);
  }
  if (exposures.settingsPanel) {
    safe.settingsPanel = projectSettingsPanel(exposures.settingsPanel);
  }
  if (exposures.workspacePanels) {
    safe.workspacePanels = exposures.workspacePanels.map(projectWorkspacePanel);
  }
  return safe;
}

/**
 * Project a resolved feature down to the UI-safe shape. The result is
 * plain JSON — no functions, no Zod schemas, no filesystem paths, no
 * feature-supplied free text beyond the by-design `title` /
 * `description`, built field-by-field from explicit allowlists.
 */
export function toUiSafeFeature(resolved: ResolvedFeature): UiSafeFeature {
  const { module, status, exposures } = resolved;
  return {
    id: module.id,
    title: module.title,
    description: module.description,
    category: module.category,
    canDisable: module.lifecycle.canDisable,
    status: projectStatus(status),
    exposures: projectExposures(exposures),
  };
}
