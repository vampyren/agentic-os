// GET /api/vault/info — read-only metadata about the operator's vault.
// Used by the Memory page (Slice 6) to render an empty preview state
// that shows where searches are running from.
//
// Returns:
//   { root: string, indexed: number }
//
// Where `root` is the absolute path of the configured vault and
// `indexed` is the current FTS5 row count. Both are values the
// operator already has access to in their own config + via the
// search API — exposing them as a tiny GET avoids hardcoding the
// path in the UI for the empty state. originOk-gated like the rest
// of the agent routes.
//
// NOT a backend security behavior change (per Slice 6 brief): no
// new read of file contents, no write surface, no traversal — just
// echoes the configured root string and the index row count.

import { loadConfig } from "@/kernel/config";
import { getVaultIndex } from "@/kernel/vaultIndex";
import { originOk, forbidden } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  try {
    const cfg = await loadConfig();
    const idx = await getVaultIndex({ vaultRoot: cfg.vault.root });
    return Response.json({
      root: cfg.vault.root,
      indexed: idx.count(),
    });
  } catch {
    return Response.json(
      { error: "internal error reading vault info", errorClass: "vault-info-error" },
      { status: 500 },
    );
  }
}
