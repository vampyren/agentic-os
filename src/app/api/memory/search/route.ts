// GET /api/memory/search?q=...&limit=30 — FTS5 search over the vault.
// Returns up to `limit` hits with title, snippet, mtime, and OS-specific
// frontmatter fields (type, agent).

import { loadConfig } from "@/kernel/config";
import { getVaultIndex } from "@/kernel/vaultIndex";
import { originOk, forbidden } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "30") || 30));

  const cfg = await loadConfig();
  const idx = await getVaultIndex({ vaultRoot: cfg.vault.root });
  const startedAt = performance.now();
  const hits = idx.search(q, limit);
  const elapsedMs = Math.round(performance.now() - startedAt);

  return Response.json({
    q,
    elapsedMs,
    indexed: idx.count(),
    hits,
  });
}
