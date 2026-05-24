// GET /api/connectors  — list configured connector instances, UI-safe
// POST /api/connectors — Add Provider flow (parse → secret-key screen →
//                        family validation → SSRF → LOCKED read-modify-write).
//
// Platform routes: the connector layer is infrastructure, not a feature, so
// these are CORS-gated like every route but NOT `gateFeatureApi`-gated
// (spec §3.7 / §14).
//
// Concurrency: the final commit goes through `updateConfig(mutator)` which
// runs the duplicate-id check + the write under one per-config-path file
// lock. Two concurrent adds with different ids both persist; two adds with
// the same id yield one 200 and one 409. The pre-validation phase
// (body → preset → family → SSRF) is intentionally outside the lock — none
// of those steps touch the config file.

import { ensureConnectorsRegistered } from "@/kernel/connectors/registered";
import { connectorRegistry } from "@/kernel/connectors/registry";
import { loadConfig } from "@/kernel/config";
import { updateConfig } from "@/kernel/config/writeConfig";
import { findSecretLookingKey } from "@/kernel/connectors/secretKeys";
import { assertPublicBaseUrl } from "@/kernel/connectors/ssrf";
import { loadPresets } from "@/kernel/connectors/presets";
import { auditConnectorAdd } from "@/kernel/audit";
import {
  getConnectorHealthStore,
  type ConnectorHealthRow,
} from "@/kernel/connectors/connectorHealth";
import { computeCurrentFingerprint } from "@/kernel/connectors/connectorFingerprint";
import type { ConnectorInstanceConfig } from "@/kernel/connectors/schema";
import { corsGate, neutral, projectConnector } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AUTHREF_REGEX = /^(none|env:[A-Za-z_][A-Za-z0-9_]*)$/;
// 64 KB is the cap for connector CONFIG-ADD JSON only. Chat prompts, agent
// context, file inputs, and future run payloads must use a different
// endpoint / storage path; do not raise this cap to accommodate them.
// Streaming byte-count enforcement (vs. the declared Content-Length here) is
// tracked as a separate hardening item.
const MAX_BODY_BYTES = 64 * 1024;

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  try {
    ensureConnectorsRegistered();
    const config = await loadConfig();
    const entries = Object.entries(config.connectors);

    // FU5 PR B — hydrate `lastValidation` from connector_health where the
    // stored config_hash matches the recomputed current fingerprint.
    //
    // Reads are best-effort: a connector_health resolution or read failure
    // is logged neutrally and swallowed; the route still returns the
    // projection without `lastValidation`. The audit JSONL + run ledger
    // remain source-of-truth (ADR-0009 / ADR-0014). The fingerprint is
    // recomputed per connector via `computeCurrentFingerprint`, which
    // mirrors the testConnection write-path dispatch (success → effective
    // config; build-failure → raw config fallback with secret-value
    // redaction). The two-path symmetry is asserted by
    // `tests/connector-fingerprint-symmetry.test.ts`.
    let healthRows: Map<string, ConnectorHealthRow> = new Map();
    try {
      const store = await getConnectorHealthStore();
      healthRows = store.getMany(entries.map(([id]) => id));
    } catch {
      console.error("[api/connectors] connector_health hydration skipped");
    }

    const connectors = entries
      .map(([id, entry]) => {
        const row = healthRows.get(id);
        let lastValidation = row?.validation;
        if (row) {
          let currentHash: string | null = null;
          try {
            currentHash = computeCurrentFingerprint(id, entry, connectorRegistry);
          } catch {
            // Defensive — computeCurrentFingerprint shouldn't throw, but
            // if it ever does, treat as a mismatch (UI falls back to
            // "not tested" rather than showing stale data).
            console.error("[api/connectors] fingerprint recompute failed");
          }
          if (currentHash === null || currentHash !== row.configHash) {
            lastValidation = undefined;
          }
        }
        return projectConnector(id, entry, lastValidation);
      })
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
  | {
      ok: false;
      errorClass: string;
      message: string;
      status: number;
      /** Present once both connectorId and presetId have validated — lets
       *  the route emit a neutral failed audit line for the attempt. */
      auditable?: { connectorId: string; presetId: string };
    };

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
  const auditable = { connectorId: b.connectorId, presetId: b.presetId };
  if (b.authRef !== undefined) {
    if (typeof b.authRef !== "string" || !AUTHREF_REGEX.test(b.authRef)) {
      // NEVER echo the raw value — neutral message only.
      return {
        ok: false,
        errorClass: "malformed-authRef",
        message: "authRef must be `env:VAR_NAME` or `none`",
        status: 400,
        auditable,
      };
    }
  }
  let settings: Record<string, unknown> = {};
  if (b.settings !== undefined) {
    if (typeof b.settings !== "object" || b.settings === null || Array.isArray(b.settings)) {
      return { ok: false, errorClass: "invalid-body", message: "invalid settings", status: 400, auditable };
    }
    settings = b.settings as Record<string, unknown>;
    if (findSecretLookingKey(settings)) {
      return {
        ok: false,
        errorClass: "secret-looking-key",
        message: "settings may not contain a secret-looking key; use authRef instead",
        status: 400,
        auditable,
      };
    }
  }
  if (b.allowLocalNetwork !== undefined && typeof b.allowLocalNetwork !== "boolean") {
    return { ok: false, errorClass: "invalid-body", message: "invalid allowLocalNetwork", status: 400, auditable };
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

  // 0. Bound the request body. A misbehaving / hostile client cannot tie
  //    up the route with a multi-megabyte body before parsing fails.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return neutral("invalid-body", "request body too large", 413);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return neutral("invalid-json", "invalid JSON body", 400);
  }

  const parsed = parseAddBody(body);
  if (!parsed.ok) {
    if (parsed.auditable) {
      await auditConnectorAdd({
        connectorId: parsed.auditable.connectorId,
        presetId: parsed.auditable.presetId,
        status: "failed",
        errorCode: parsed.errorClass,
      });
    }
    return neutral(parsed.errorClass, parsed.message, parsed.status);
  }
  const { connectorId, presetId, authRef, settings, allowLocalNetwork } = parsed.body;

  const auditFail = (errorCode: string): Promise<void> =>
    auditConnectorAdd({ connectorId, presetId, status: "failed", errorCode });

  try {
    ensureConnectorsRegistered();

    // Preset + family lookup (no config file touched).
    const presets = await loadPresets();
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      await auditFail("preset-unknown");
      return neutral("preset-unknown", "preset not found", 400);
    }
    const family = connectorRegistry.get(preset.typeFamily);
    if (!family) {
      // Shouldn't happen after ensureConnectorsRegistered(); defensive.
      await auditFail("family-unknown");
      return neutral("family-unknown", "connector family is not registered", 500);
    }

    // Materialize + re-screen merged + family-validate (still no file I/O).
    const mergedSettings = {
      ...(family.defaultSettings as Record<string, unknown>),
      ...preset.defaultSettings,
      ...settings,
    };
    if (findSecretLookingKey(mergedSettings)) {
      await auditFail("secret-looking-key");
      return neutral(
        "secret-looking-key",
        "merged settings contain a secret-looking key; use authRef instead",
        400,
      );
    }
    const familyParsed = family.settingsSchema.safeParse(mergedSettings);
    if (!familyParsed.success) {
      await auditFail("settings-invalid");
      return neutral("settings-invalid", "connector settings are invalid", 400);
    }

    const effectiveAllowLocalNetwork =
      allowLocalNetwork ?? preset.allowLocalNetwork ?? false;

    // SSRF (out-of-lock; the lookup runs against DNS / IP literals, not the
    // config file). The block decision is final — no config write happens.
    if (family.transport === "http") {
      const baseUrl = (familyParsed.data as { baseUrl?: unknown }).baseUrl;
      if (typeof baseUrl === "string") {
        try {
          await assertPublicBaseUrl(baseUrl, {
            allowLocalNetwork: effectiveAllowLocalNetwork,
          });
        } catch {
          await auditFail("blocked-network");
          return neutral(
            "blocked-network",
            "connector baseUrl is in a blocked range",
            400,
          );
        }
      }
    }

    const entry: ConnectorInstanceConfig = {
      enabled: true,
      typeFamily: preset.typeFamily,
      presetId,
      ...(authRef ? { authRef } : {}),
      settings: familyParsed.data as Record<string, unknown>,
      ...(preset.capabilities ? { capabilities: preset.capabilities } : {}),
      ...(effectiveAllowLocalNetwork ? { allowLocalNetwork: true } : {}),
    };

    // LOCKED read-modify-write. The duplicate-id check runs INSIDE the lock
    // against the freshly-read on-disk config — closes the TOCTOU race
    // (two concurrent adds with the same id can no longer both succeed).
    // `updateConfig` reads the on-disk config WITHOUT applying runtime env
    // overrides (e.g. AGENTIC_OS_VAULT), so a runtime override of
    // `vault.root` is never persisted back.
    try {
      await updateConfig((current) => {
        if (current.connectors[connectorId]) {
          const err: Error & { errorCode?: string } = new Error("duplicate");
          err.errorCode = "duplicate-id";
          throw err;
        }
        return {
          ...current,
          connectors: { ...current.connectors, [connectorId]: entry },
        };
      });
    } catch (err) {
      if (
        err instanceof Error
        && (err as Error & { errorCode?: string }).errorCode === "duplicate-id"
      ) {
        await auditFail("duplicate-id");
        return neutral(
          "duplicate-id",
          "a connector with this id already exists",
          409,
        );
      }
      throw err;
    }

    await auditConnectorAdd({ connectorId, presetId, status: "success" });

    return Response.json({
      ok: true,
      connector: projectConnector(connectorId, entry),
    });
  } catch {
    await auditFail("internal-error");
    return neutral("internal-error", "could not add connector", 500);
  }
}
