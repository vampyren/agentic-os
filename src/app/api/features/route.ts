// Feature projection endpoint (Phase 1C — M1).
//
//   GET /api/features  →  { features: UiSafeFeature[] }
//
// The UI-safe projection: every entry carries id / title / description
// / category / lifecycle status / UI exposures — and nothing else. No
// config schema, no config defaults, no health function, no raw
// filesystem path crosses to the browser (see projection.ts).
//
// Only GET is exported; any other method gets Next's automatic 405.

import { originOk, forbidden } from "../_lib/cors";
import { ensureFeaturesRegistered } from "@/kernel/features/registered";
import { resolveAllFeatures } from "@/kernel/features/resolver";
import { toUiSafeFeature } from "@/kernel/features/projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!originOk(req)) return forbidden();
  ensureFeaturesRegistered();
  const all = await resolveAllFeatures();
  return Response.json({ features: all.map(toUiSafeFeature) });
}
