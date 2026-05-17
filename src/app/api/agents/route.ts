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
    // Surface action metadata so the AgentRoom rail can render chips
    // without an extra round-trip. We omit `command` from the public shape
    // — the UI only needs id/label/output. Command stays server-side and
    // is invoked through /api/agents/[name]/actions/[id].
    // Includes argv so the UI can show a "Run `verb`" tooltip on each
    // chip — this is localhost-only and the YAML is operator-visible, so
    // there's no security gain from hiding the command from the UI.
    actions: (m.actions ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      command: a.command,
      ...(a.hint ? { hint: a.hint } : {}),
      ...(a.output ? { output: a.output } : {}),
    })),
  }));
  return Response.json({ agents });
}
