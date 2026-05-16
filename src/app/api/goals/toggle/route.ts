// PATCH /api/goals/toggle — flip a goal between open and done.
// Body: { path: string, to: "open" | "done" }

import { loadConfig } from "@/kernel/config";
import { updateFrontmatter } from "@/vault/writer";
import { originOk, forbidden } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!originOk(req)) return forbidden();

  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response("invalid json", { status: 400 }); }

  const { path: relPath, to } = (body ?? {}) as { path?: unknown; to?: unknown };
  if (typeof relPath !== "string" || relPath.length === 0) {
    return new Response("missing path", { status: 400 });
  }
  if (to !== "open" && to !== "done") {
    return new Response("`to` must be 'open' or 'done'", { status: 400 });
  }

  const cfg = await loadConfig();
  try {
    const result = await updateFrontmatter({
      vaultRoot: cfg.vault.root,
      relPath,
      agent: "operator",
      patch: { goalStatus: to },
    });
    return Response.json({ ok: true, path: result.path });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
