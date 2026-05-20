// Manual mission-run API (Phase 1C — M4).
//
//   POST /api/missions/<id>/run   body: { options?: object }   → JSON
//
// Triggers ONE manual run of a registered mission. M4 has no cron /
// scheduler runtime — automatic scheduled firing is a later milestone;
// this route is the only way a mission runs.
//
// The route validates only the request ENVELOPE strictly: the body
// must be `{ options?: <plain object> }` and nothing else. It does NOT
// schema-validate the `options` object itself — that is the mission's
// own .strict() optionsSchema, applied inside the runner. No
// z.unknown() / passthrough option bag lives here; the raw options
// object is forwarded to the runner unchanged.
//
// Responses are neutral single JSON objects. A failure carries an
// errorClass + a generic message, never a raw path, a stack, or the
// caller's options.

import { missionRegistry } from "@/features/scheduler/missions/registry";
import { runMission } from "@/features/scheduler/missions/runner";
import { ensureBuiltinMissions } from "@/features/scheduler/missions/builtin";
import { originOk, forbidden } from "../../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function neutral(errorClass: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: message, errorClass }, { status });
}

/**
 * Strict envelope check — no Zod, no z.unknown bag. The body must be a
 * plain object whose only key is an optional `options` plain object.
 */
function readEnvelope(
  body: unknown,
): { ok: true; options: Record<string, unknown> } | { ok: false } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false };
  }
  for (const key of Object.keys(body)) {
    if (key !== "options") return { ok: false };
  }
  const options = (body as { options?: unknown }).options;
  if (options === undefined) return { ok: true, options: {} };
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { ok: false };
  }
  return { ok: true, options: options as Record<string, unknown> };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!originOk(req)) return forbidden();
  try {
    // Built-in missions are registered into the global registry on
    // demand — idempotent, so safe to call on every request.
    ensureBuiltinMissions();

    // Decode the [id] route param — a malformed % escape is a 400.
    const { id: rawId } = await ctx.params;
    let missionId: string;
    try {
      missionId = decodeURIComponent(rawId);
    } catch {
      return neutral("mission-id-malformed", "malformed mission id", 400);
    }

    if (!missionRegistry.get(missionId)) {
      return neutral("mission-unknown", "no such mission", 404);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return neutral("invalid-json", "invalid JSON body", 400);
    }

    const envelope = readEnvelope(body);
    if (!envelope.ok) {
      return neutral("invalid-body", "invalid request body", 400);
    }

    const result = await runMission({
      missionId,
      trigger: "manual",
      rawOptions: envelope.options,
    });

    if (result.status === "failed") {
      const status =
        result.errorClass === "mission-options-invalid"
          ? 400
          : result.errorClass === "mission-not-manual" ||
              result.errorClass === "mission-permission-denied"
            ? 403
            : result.errorClass === "mission-unknown"
              ? 404
              : 500;
      return Response.json(
        { ok: false, error: result.message, errorClass: result.errorClass },
        { status },
      );
    }

    return Response.json({
      ok: true,
      runId: result.runId,
      missionId: result.missionId,
      status: result.status,
      message: result.message,
      outputs: result.outputs,
    });
  } catch {
    return Response.json(
      { ok: false, error: "internal mission run error", errorClass: "internal-error" },
      { status: 500 },
    );
  }
}
