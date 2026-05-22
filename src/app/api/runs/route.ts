// GET /api/runs — list runs, newest-first, filterable by status / kind /
// featureId / limit.
//
// Platform route: the run ledger is infrastructure, not a feature, so this is
// CORS-gated like every route but NOT feature-gated. Read-only — runs are
// created by producers (the scheduler), never by the browser.

import { getRunLedger } from "@/kernel/state/runLedger";
import { corsGate, neutral, parseRunsQuery, toRunSummary } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  const parsed = parseRunsQuery(new URL(req.url));
  if (!parsed.ok) return parsed.response;

  try {
    const ledger = await getRunLedger();
    const runs = ledger.listRuns(parsed.filter).map(toRunSummary);
    return Response.json({ ok: true, runs });
  } catch {
    return neutral("internal-error", "could not list runs", 500);
  }
}
