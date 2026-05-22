// POST /api/runs/<id>/cancel — cancel a non-terminal run (and, via the
// ledger's cascade, its non-terminal descendants). The API actor is "user".
//
// Platform route: CORS-gated, not feature-gated. Neutral errors —
// unknown id -> 404, already-terminal run -> 409.

import { getRunLedger } from "@/kernel/state/runLedger";
import { corsGate, ledgerErrorResponse, neutral, toRunSummary } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  try {
    const { id } = await ctx.params;
    const ledger = await getRunLedger();
    const run = ledger.cancelRun(id, "user");
    return Response.json({ ok: true, run: toRunSummary(run) });
  } catch (err) {
    return (
      ledgerErrorResponse(err)
      ?? neutral("internal-error", "could not cancel run", 500)
    );
  }
}
