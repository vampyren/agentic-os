// GET /api/connectors/presets — the connector preset catalog.
//
// Returns first-party presets (build's `presets/` dir) AND user presets
// (`~/.agentic-os/presets/` or `AGENTIC_OS_PRESETS_DIR`) — user presets are
// trust-clamped downward (B8 / spec §13). A preset whose `defaultSettings`
// has a secret-looking key (B4) is skipped neutrally.

import { loadPresets } from "@/kernel/connectors/presets";
import { corsGate, neutral } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = corsGate(req);
  if (blocked) return blocked;

  try {
    const presets = await loadPresets();
    return Response.json({ ok: true, presets });
  } catch {
    return neutral("internal-error", "could not list presets", 500);
  }
}
