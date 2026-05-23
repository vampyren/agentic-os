// POST /api/connectors/<id>/test — run the connector's testConnection as a
// Run. Network testing belongs HERE; the Add-Provider POST validates only
// the local config + SSRF (spec §14, req 9).
//
// Returns the neutral ConnectorValidation produced by runConnectorTest
// (M4a-1). Errors are sanitized (B10 / B13); raw provider responses /
// `Location` headers / paths never leak.

import { ensureConnectorsRegistered } from "@/kernel/connectors/registered";
import { loadConfig } from "@/kernel/config";
import { runConnectorTest } from "@/kernel/connectors/testConnection";
import { corsGate, neutral } from "../../_shared";

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
    ensureConnectorsRegistered();
    const config = await loadConfig();
    if (!config.connectors[id]) {
      return neutral("not-found", "connector not found", 404);
    }
    const validation = await runConnectorTest(id);
    return Response.json({ ok: true, validation });
  } catch {
    return neutral("internal-error", "could not test connector", 500);
  }
}
