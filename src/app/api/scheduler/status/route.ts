import { getGlobalMissionSchedulerSnapshot } from "@/features/scheduler/runtime";
import { forbidden, originOk } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!originOk(req)) return forbidden();
  return Response.json({
    ok: true,
    scheduler: getGlobalMissionSchedulerSnapshot(),
  });
}
