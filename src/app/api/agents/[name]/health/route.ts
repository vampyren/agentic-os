// GET /api/agents/[name]/health — on-demand health probe for a single agent.
// In Phase 1B this will be backed by a cached probe loop; for 1A every call
// re-runs the probe synchronously.

import { registry } from "@/kernel/registry";
import { originOk, forbidden } from "../../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!originOk(req)) return forbidden();
  await registry.init();
  const { name } = await ctx.params;
  const report = await registry.health(name);
  return Response.json({ name, report });
}
