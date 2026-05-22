// GET /api/runs/<id> — one run with its steps and external references.
//
// Platform route: CORS-gated, not feature-gated. Returns the redacted
// RunSummary projection; an unknown id is a neutral 404.

import { getRunLedger } from "@/kernel/state/runLedger";
import { corsGate, neutral, toRunSummary } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  try {
    const { id } = await ctx.params;
    const ledger = await getRunLedger();
    const run = ledger.getRun(id);
    if (!run) return neutral("not-found", "run not found", 404);

    return Response.json({
      ok: true,
      run: toRunSummary(run),
      steps: ledger.listSteps(id),
      externalRefs: ledger.listExternalRefs(id),
    });
  } catch {
    return neutral("internal-error", "could not load run", 500);
  }
}
