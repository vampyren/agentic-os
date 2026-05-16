// GET /api/vitals — snapshot of every agent's last-known health status.
//
// Phase 1B note: in v0.2.0 commit 1 this endpoint returns each agent with
// status "unknown" (no probe loop yet). Commit 2 wires it to the real
// kernel health probe loop with cached state.

import { registry } from "@/kernel/registry";
import { getHealthSnapshot } from "@/kernel/health";
import { originOk, forbidden } from "../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  await registry.init();
  const snapshot = getHealthSnapshot();
  const agents = registry.list().map((m) => {
    const cached = snapshot[m.name];
    return {
      name: m.name,
      displayName: m.displayName,
      transport: m.transport,
      status: cached?.status ?? "unknown",
      version: cached?.version,
      latencyMs: cached?.latencyMs,
      checkedAt: cached?.checkedAt,
    };
  });
  return Response.json({ ts: Date.now(), agents });
}
