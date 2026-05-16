// GET /api/agents — list every agent the registry has loaded. Cheap, no health
// probes triggered here; health endpoint is separate.

import { registry } from "@/kernel/registry";
import { originOk, forbidden } from "../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  await registry.init();
  const agents = registry.list().map((m) => ({
    name: m.name,
    displayName: m.displayName,
    description: m.description ?? null,
    transport: m.transport,
    capabilities: m.capabilities ?? {},
  }));
  return Response.json({ agents });
}
