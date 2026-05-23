// Settings → Connectors client-side API helpers (M4a — PR3c).
//
// Thin wrappers around the platform routes built in PR3b. No business logic
// — these just shape the response so the UI can render success/failure
// uniformly.

import type { CapabilityId } from "@/kernel/capabilities/types";

export interface ConnectorListItem {
  connectorId: string;
  typeFamily: string;
  presetId?: string;
  enabled: boolean;
  trust: "first-party" | "community" | "untrusted" | "unknown";
  capabilities: CapabilityId[];
  authRefKind: "env" | "none" | "unset";
  allowLocalNetwork?: boolean;
}

export interface ConnectorPreset {
  id: string;
  label: string;
  description?: string;
  typeFamily: string;
  defaultSettings: Record<string, unknown>;
  capabilities?: CapabilityId[];
  allowLocalNetwork?: boolean;
  authPrompt?: {
    apiKeyEnvVar?: { label: string; helpUrl?: string };
    baseUrl?: { label: string; default?: string };
  };
  trust: "first-party" | "community" | "untrusted";
}

export interface ConnectorValidation {
  status: "valid" | "invalid" | "unreachable" | "misconfigured" | "unknown";
  errorCode?: string;
  message?: string;
  testedAt: string;
  durationMs: number;
}

export type AddConnectorResult =
  | { ok: true; connector: ConnectorListItem }
  | { ok: false; errorClass: string; error: string };

export interface AddConnectorBody {
  connectorId: string;
  presetId: string;
  authRef?: string;
  settings?: Record<string, unknown>;
  allowLocalNetwork?: boolean;
}

export async function fetchConnectors(): Promise<ConnectorListItem[]> {
  const res = await fetch("/api/connectors");
  if (!res.ok) return [];
  const body = (await res.json()) as { ok: boolean; connectors?: ConnectorListItem[] };
  return body.connectors ?? [];
}

export async function fetchPresets(): Promise<ConnectorPreset[]> {
  const res = await fetch("/api/connectors/presets");
  if (!res.ok) return [];
  const body = (await res.json()) as { ok: boolean; presets?: ConnectorPreset[] };
  return body.presets ?? [];
}

export async function addConnector(body: AddConnectorBody): Promise<AddConnectorResult> {
  const res = await fetch("/api/connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as
    | { ok: true; connector: ConnectorListItem }
    | { ok: false; errorClass: string; error: string };
  return data;
}

export async function testConnector(id: string): Promise<ConnectorValidation | null> {
  const res = await fetch(`/api/connectors/${encodeURIComponent(id)}/test`, {
    method: "POST",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { ok: boolean; validation?: ConnectorValidation };
  return body.validation ?? null;
}

// ── Model discovery (M4a-5 PR C) ───────────────────────────────────────────

export interface DiscoverModelsBody {
  presetId: string;
  /** `env:VAR_NAME` or `none` — the server checks the shape. */
  authRef?: string;
  /** baseUrl + any operator overrides; routed through the route's
   *  secret-key screen + SSRF guard. */
  settings?: Record<string, unknown>;
  allowLocalNetwork?: boolean;
}

export interface DiscoveredModel {
  id: string;
}

export type DiscoverModelsResult =
  | { ok: true; models: ReadonlyArray<DiscoveredModel> }
  | { ok: false; errorClass: string; message: string };

/**
 * POST /api/connectors/models/preview — pre-save model discovery.
 *
 * Returns a typed result so the UI can render success / neutral failure
 * uniformly. NEVER inspects, displays, or logs the resolved secret, raw
 * provider response, or env var VALUE — only the route's closed neutral
 * `errorClass` strings cross.
 */
export async function discoverModels(body: DiscoverModelsBody): Promise<DiscoverModelsResult> {
  let res: Response;
  try {
    res = await fetch("/api/connectors/models/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, errorClass: "network-unreachable", message: discoveryMessageFor("network-unreachable") };
  }

  const data = await res.json().catch(() => null) as
    | { ok: true; models: ReadonlyArray<DiscoveredModel> }
    | { ok: false; errorClass?: string; error?: string }
    | null;

  if (data && (data as { ok?: boolean }).ok) {
    const models = (data as { models?: ReadonlyArray<DiscoveredModel> }).models ?? [];
    return { ok: true, models };
  }
  const errorClass = (data && (data as { errorClass?: string }).errorClass) ?? "internal-error";
  return { ok: false, errorClass, message: discoveryMessageFor(errorClass) };
}

/**
 * Map the closed neutral error-class set the route emits to operator-
 * facing messages. NEVER includes the env var name, baseUrl, raw fetch
 * error, secret value, or any provider-response fragment — those values
 * never reach the client in the first place; this function just labels
 * the route's classes.
 */
export function discoveryMessageFor(errorClass: string): string {
  switch (errorClass) {
    case "preset-unknown":
      return "Provider preset not found.";
    case "capability-not-supported":
      return "This provider does not support model discovery.";
    case "secret-looking-key":
      return "Settings contain a secret-looking key. Use the env var name field for credentials.";
    case "malformed-authRef":
      return "Auth field must be an environment-variable NAME (letters, digits, underscores).";
    case "settings-invalid":
      return "Provider settings are invalid. Check the Base URL.";
    case "blocked-network":
      return "Base URL is in a blocked local-network range. Enable “Allow local network” if intended.";
    case "auth-failed":
      return "The provider rejected the credential. Check the env var value on the server.";
    case "auth-missing":
      return "The named environment variable is empty or unset on the server.";
    case "rate-limited":
      return "The provider rate-limited the request. Wait and try again.";
    case "network-unreachable":
      return "Could not reach the provider.";
    case "response-too-large":
      return "The provider returned an unexpectedly large response.";
    case "external-system-unavailable":
      return "Could not load models from the provider.";
    case "invalid-body":
    case "invalid-json":
      return "Could not send the discovery request.";
    case "internal-error":
    default:
      return "Could not load models.";
  }
}
