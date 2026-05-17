// GET /api/memory/search?q=...&limit=30 — FTS5 search over the vault.
// Returns up to `limit` hits with title, snippet, mtime, and OS-specific
// frontmatter fields (type, agent).

import { loadConfig } from "@/kernel/config";
import { getVaultIndex } from "@/kernel/vaultIndex";
import { originOk, forbidden } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SCOPES = new Set(["all", "chats"]);

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "30") || 30));
  const scopeRaw = url.searchParams.get("scope") ?? "all";
  const scope = ALLOWED_SCOPES.has(scopeRaw) ? scopeRaw : "all";

  const cfg = await loadConfig();
  const idx = await getVaultIndex({ vaultRoot: cfg.vault.root });
  const startedAt = performance.now();
  const rawHits = idx.search(q, scope === "chats" ? Math.min(100, limit * 2) : limit);
  // Post-filter on frontmatter `type` — the FTS5 query doesn't index meta
  // columns, and chats-only is a small enough corpus that a JS filter is
  // fine. Avoids needing a parallel FTS table per type.
  const hits = scope === "chats"
    ? rawHits.filter((h) => h.type === "chat").slice(0, limit)
    : rawHits;
  const elapsedMs = Math.round(performance.now() - startedAt);

  return Response.json({
    q,
    scope,
    elapsedMs,
    indexed: idx.count(),
    hits,
  });
}
