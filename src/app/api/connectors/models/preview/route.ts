// POST /api/connectors/models/preview — pre-save model discovery (M4a-5
// PR AB, spec §5.4).
//
// The Add Provider flow calls this BEFORE saving the connector — it lets the
// operator click "Load models" and get a real model list keyed to a preset +
// the currently-typed settings + authRef. The route mirrors the body shape
// of POST /api/connectors (minus `connectorId` — no instance is created).
//
// Locked discipline (matches POST /api/connectors):
//   * CORS-gated like every platform route.
//   * 64 KB body cap before parse — content-length check + neutral 413.
//   * Hand-rolled body validation (NOT Zod messages) so a raw value the
//     operator pasted into `authRef` never gets echoed back.
//   * Secret-key screen on `body.settings` BEFORE any kernel call.
//   * authRef format validated against AUTHREF_REGEX.
//   * Everything beyond that lives in `runDiscoverModels`; the route
//     simply maps the closed DiscoverErrorCode union to neutral HTTP.
//
// NEVER in the response, audit, or log: secrets, env var name, Authorization
// header, baseUrl, raw provider response, raw fetch error.

import {
  runDiscoverModels,
  type DiscoverErrorCode,
} from "@/kernel/connectors/discovery";
import { findSecretLookingKey } from "@/kernel/connectors/secretKeys";
import { ensureConnectorsRegistered } from "@/kernel/connectors/registered";
import { auditConnectorModelsDiscover } from "@/kernel/audit";
import { corsGate, neutral } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const AUTHREF_REGEX = /^(none|env:[A-Za-z_][A-Za-z0-9_]*)$/;
const MAX_BODY_BYTES = 64 * 1024;

interface PreviewBody {
  presetId: string;
  authRef?: string;
  settings?: Record<string, unknown>;
  allowLocalNetwork?: boolean;
}

type ParseResult =
  | { ok: true; body: PreviewBody }
  | {
      ok: false;
      errorClass: string;
      message: string;
      status: number;
      /** Present once presetId has validated — lets the route emit a neutral
       *  failed audit line for the attempt. */
      auditable?: { presetId: string };
    };

function parsePreviewBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errorClass: "invalid-body", message: "invalid request body", status: 400 };
  }
  const b = body as Record<string, unknown>;
  const ALLOWED = new Set([
    "presetId", "authRef", "settings", "allowLocalNetwork",
  ]);
  for (const key of Object.keys(b)) {
    if (!ALLOWED.has(key)) {
      return { ok: false, errorClass: "invalid-body", message: "unknown field in request body", status: 400 };
    }
  }
  if (typeof b.presetId !== "string" || !SLUG_REGEX.test(b.presetId)) {
    return { ok: false, errorClass: "invalid-body", message: "invalid presetId", status: 400 };
  }
  const auditable = { presetId: b.presetId };
  if (b.authRef !== undefined) {
    if (typeof b.authRef !== "string" || !AUTHREF_REGEX.test(b.authRef)) {
      return {
        ok: false,
        errorClass: "malformed-authRef",
        message: "authRef must be `env:VAR_NAME` or `none`",
        status: 400,
        auditable,
      };
    }
  }
  let settings: Record<string, unknown> | undefined;
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
      presetId: b.presetId,
      authRef: b.authRef as string | undefined,
      ...(settings !== undefined ? { settings } : {}),
      allowLocalNetwork: b.allowLocalNetwork as boolean | undefined,
    },
  };
}

/** Map the closed DiscoverErrorCode union to a neutral HTTP status. */
function statusFor(code: DiscoverErrorCode): number {
  switch (code) {
    case "internal-error":
    case "external-system-unavailable":
      return 502;
    case "preset-unknown":
    case "settings-invalid":
    case "secret-looking-key":
    case "malformed-authRef":
    case "blocked-network":
    case "capability-not-supported":
    case "auth-failed":
    case "auth-missing":
    case "rate-limited":
    case "response-too-large":
    case "network-unreachable":
      return 400;
  }
}

export async function POST(req: Request) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  // 0. content-length cap — symmetric with POST /api/connectors.
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

  const parsed = parsePreviewBody(body);
  if (!parsed.ok) {
    if (parsed.auditable) {
      await auditConnectorModelsDiscover({
        presetId: parsed.auditable.presetId,
        status: "failed",
        errorCode: parsed.errorClass,
      });
    }
    return neutral(parsed.errorClass, parsed.message, parsed.status);
  }

  try {
    ensureConnectorsRegistered();
    const outcome = await runDiscoverModels(parsed.body);
    if (outcome.ok) {
      return Response.json({ ok: true, models: outcome.models });
    }
    return neutral(outcome.errorCode, outcome.errorCode, statusFor(outcome.errorCode));
  } catch {
    // runDiscoverModels does NOT throw on connector failures; this catches
    // pathological exceptions (e.g. registry init wedged). The route still
    // audits one neutral failed line.
    await auditConnectorModelsDiscover({
      presetId: parsed.body.presetId,
      status: "failed",
      errorCode: "internal-error",
    });
    return neutral("internal-error", "could not discover models", 500);
  }
}
