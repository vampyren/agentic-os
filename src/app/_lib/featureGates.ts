// Feature route gates (Phase 1C — M1).
//
// These live in the APP layer, not the kernel, on purpose: they depend
// on next/navigation (`notFound`) and the API CORS helper, and the
// kernel feature foundation must not depend on the Next app layer.
// Per v8 §5.3 the gates are explicit per-route imports — NOT Next
// middleware, which can run in runtimes that must not load local
// config/state.
//
//   requireFeatureReady    page gate — only "ready" passes
//   requireFeatureEnabled  page gate — anything but "disabled" passes
//   gateFeatureApi         API gate — returns a Response to short-circuit,
//                          or null to let the handler proceed

import { notFound } from "next/navigation";
import { originOk } from "../api/_lib/cors";
import { ensureFeaturesRegistered } from "@/kernel/features/registered";
import { resolveFeature } from "@/kernel/features/resolver";
import type {
  ResolvedFeature,
  FeatureResolveDeps,
} from "@/kernel/features/resolver";
import type { FeatureId } from "@/kernel/features/types";

/** Page gate: render the page only when the feature is fully `ready`. */
export async function requireFeatureReady(
  id: FeatureId,
  deps?: FeatureResolveDeps,
): Promise<ResolvedFeature> {
  ensureFeaturesRegistered();
  const feature = await resolveFeature(id, deps);
  if (!feature || feature.status.state !== "ready") notFound();
  return feature;
}

/** Page gate: render the page unless the feature is `disabled`. */
export async function requireFeatureEnabled(
  id: FeatureId,
  deps?: FeatureResolveDeps,
): Promise<ResolvedFeature> {
  ensureFeaturesRegistered();
  const feature = await resolveFeature(id, deps);
  if (!feature || feature.status.state === "disabled") notFound();
  return feature;
}

export type FeatureApiGateMode = "enabled" | "ready" | "status-only";

/**
 * API gate. Returns a `Response` to short-circuit the handler, or
 * `null` to let it proceed.
 *
 * Unknown feature ids 404 in EVERY mode, status-only included:
 * status-only means "let a KNOWN feature through even when disabled",
 * not "let typos and removed features through".
 */
export async function gateFeatureApi(
  req: Request,
  id: FeatureId,
  mode: FeatureApiGateMode,
  deps?: FeatureResolveDeps,
): Promise<Response | null> {
  if (!originOk(req)) {
    return new Response("forbidden: cross-origin request rejected", {
      status: 403,
    });
  }
  ensureFeaturesRegistered();

  const feature = await resolveFeature(id, deps);
  if (!feature) return new Response("not found", { status: 404 });

  if (mode === "status-only") return null;

  if (feature.status.state === "disabled") {
    return new Response("not found", { status: 404 });
  }
  if (mode === "ready" && feature.status.state !== "ready") {
    return Response.json(
      { error: "feature-not-ready", reasons: feature.status.reasons },
      { status: 503 },
    );
  }
  return null;
}
