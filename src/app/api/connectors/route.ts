// GET /api/connectors  — list configured connector instances, UI-safe
// POST /api/connectors — Add Provider flow (parse → secret-key screen →
//                        family validation → SSRF → atomic write).
//
// Platform routes: the connector layer is infrastructure, not a feature, so
// these are CORS-gated like every route but NOT `gateFeatureApi`-gated
// (spec §3.7 / §14).

import { ensureConnectorsRegistered } from "@/kernel/connectors/registered";
import { connectorRegistry } from "@/kernel/connectors/registry";
import { loadConfig } from "@/kernel/config";
import { findSecretLookingKey } from "@/kernel/connectors/secretKeys";
import { assertPublicBaseUrl } from "@/kernel/connectors/ssrf";
import { loadPresets } from "@/kernel/connectors/presets";
import { writeConfig } from "@/kernel/config/writeConfig";
import { auditConnectorAdd } from "@/kernel/audit";
import type { ConnectorInstanceConfig } from "@/kernel/connectors/schema";
import { corsGate, neutral, projectConnector } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AUTHREF_REGEX = /^(none|env:[A-Za-z_][A-Za-z0-9_]*)$/;

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  try {
    ensureConnectorsRegistered();
    const config = await loadConfig();
    const connectors = Object.entries(config.connectors)
      .map(([id, entry]) => projectConnector(id, entry))
      .sort((a, b) => a.connectorId.localeCompare(b.connectorId));
    return Response.json({ ok: true, connectors });
  } catch {
    return neutral("internal-error", "could not list connectors", 500);
  }
}

// ── POST ───────────────────────────────────────────────────────────────────

interface AddBody {
  connectorId: string;
  presetId: string;
  authRef?: string;
  settings: Record<string, unknown>;
  allowLocalNetwork?: boolean;
}

type ParseResult =
  | { ok: true; body: AddBody }
  | { ok: false; errorClass: string; message: string; status: number };

/**
 * Hand-rolled body validation — deliberately NOT using a Zod error message,
 * so an operator-supplied raw value (e.g. an API key landed in `authRef`)
 * never gets echoed back, audited, or logged.
 */
function parseAddBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errorClass: "invalid-body", message: "invalid request body", status: 400 };
  }
  const b = body as Record<string, unknown>;
  const ALLOWED = new Set([
    "connectorId", "presetId", "authRef", "settings", "allowLocalNetwork",
  ]);
  for (const key of Object.keys(b)) {
    if (!ALLOWED.has(key)) {
      return { ok: false, errorClass: "invalid-body", message: "unknown field in request body", status: 400 };
    }
  }
  if (typeof b.connectorId !== "string" || !SLUG_REGEX.test(b.connectorId)) {
    return { ok: false, errorClass: "invalid-body", message: "invalid connectorId", status: 400 };
  }
  if (typeof b.presetId !== "string" || !SLUG_REGEX.test(b.presetId)) {
    return { ok: false, errorClass: "invalid-body", message: "invalid presetId", status: 400 };
  }
  if (b.authRef !== undefined) {
    if (typeof b.authRef !== "string" || !AUTHREF_REGEX.test(b.authRef)) {
      // NEVER echo the raw value — neutral message only.
      return {
        ok: false,
        errorClass: "malformed-authRef",
        message: "authRef must be `env:VAR_NAME` or `none`",
        status: 400,
      };
    }
  }
  let settings: Record<string, unknown> = {};
  if (b.settings !== undefined) {
    if (typeof b.settings !== "object" || b.settings === null || Array.isArray(b.settings)) {
      return { ok: false, errorClass: "invalid-body", message: "invalid settings", status: 400 };
    }
    settings = b.settings as Record<string, unknown>;
    if (findSecretLookingKey(settings)) {
      return {
        ok: false,
        errorClass: "secret-looking-key",
        message: "settings may not contain a secret-looking key; use authRef instead",
        status: 400,
      };
    }
  }
  if (b.allowLocalNetwork !== undefined && typeof b.allowLocalNetwork !== "boolean") {
    return { ok: false, errorClass: "invalid-body", message: "invalid allowLocalNetwork", status: 400 };
  }
  return {
    ok: true,
    body: {
      connectorId: b.connectorId,
      presetId: b.presetId,
      authRef: b.authRef as string | undefined,
      settings,
      allowLocalNetwork: b.allowLocalNetwork as boolean | undefined,
    },
  };
}

export async function POST(req: Request) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  // 1. Parse the JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return neutral("invalid-json", "invalid JSON body", 400);
  }

  // 2. Body envelope + secret-key screen on body.settings + strict authRef.
  const parsed = parseAddBody(body);
  if (!parsed.ok) {
    return neutral(parsed.errorClass, parsed.message, parsed.status);
  }
  const { connectorId, presetId, authRef, settings, allowLocalNetwork } = parsed.body;

  try {
    ensureConnectorsRegistered();
    const config = await loadConfig();

    // 3. Duplicate-id check.
    if (config.connectors[connectorId]) {
      return neutral("duplicate-id", "a connector with this id already exists", 409);
    }

    // 4. Preset lookup.
    const presets = await loadPresets();
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      return neutral("preset-unknown", "preset not found", 400);
    }

    // 5. Family lookup.
    const family = connectorRegistry.get(preset.typeFamily);
    if (!family) {
      // Shouldn't happen after ensureConnectorsRegistered(); defensive.
      return neutral("family-unknown", "connector family is not registered", 500);
    }

    // 6. Materialize settings — family defaults <- preset defaults <- body.
    const mergedSettings = {
      ...(family.defaultSettings as Record<string, unknown>),
      ...preset.defaultSettings,
      ...settings,
    };
    // 7. Re-screen merged settings (spec req 3 / B4).
    if (findSecretLookingKey(mergedSettings)) {
      return neutral(
        "secret-looking-key",
        "merged settings contain a secret-looking key; use authRef instead",
        400,
      );
    }
    // 8. Family schema validation.
    const familyParsed = family.settingsSchema.safeParse(mergedSettings);
    if (!familyParsed.success) {
      return neutral("settings-invalid", "connector settings are invalid", 400);
    }

    // 9. Effective `allowLocalNetwork` — body, then preset, then false.
    const effectiveAllowLocalNetwork =
      allowLocalNetwork ?? preset.allowLocalNetwork ?? false;

    // 10. SSRF — HTTP families only — BEFORE write.
    if (family.transport === "http") {
      const baseUrl = (familyParsed.data as { baseUrl?: unknown }).baseUrl;
      if (typeof baseUrl === "string") {
        try {
          await assertPublicBaseUrl(baseUrl, {
            allowLocalNetwork: effectiveAllowLocalNetwork,
          });
        } catch {
          return neutral(
            "blocked-network",
            "connector baseUrl is in a blocked range",
            400,
          );
        }
      }
    }

    // 11. Materialize the instance config and atomic-write.
    const entry: ConnectorInstanceConfig = {
      enabled: true,
      typeFamily: preset.typeFamily,
      presetId,
      ...(authRef ? { authRef } : {}),
      settings: familyParsed.data as Record<string, unknown>,
      ...(preset.capabilities ? { capabilities: preset.capabilities } : {}),
      ...(effectiveAllowLocalNetwork ? { allowLocalNetwork: true } : {}),
    };
    const newConfig = {
      ...config,
      connectors: { ...config.connectors, [connectorId]: entry },
    };
    await writeConfig(newConfig);

    // 12. Neutral audit line — no settings, authRef, baseUrl, or body.
    void auditConnectorAdd({ connectorId, presetId, status: "success" });

    return Response.json({
      ok: true,
      connector: projectConnector(connectorId, entry),
    });
  } catch {
    return neutral("internal-error", "could not add connector", 500);
  }
}
