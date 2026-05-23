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
