// GET /api/memory/note?path=<rel> — fetch a single vault note for the
// Memory page's preview pane. Path traversal is enforced inside
// vault/reader.ts (readNote asserts under root). We additionally clamp
// body size so a giant note doesn't bloat the response.

import { loadConfig } from "@/kernel/config";
import { readNote } from "@/vault/reader";
import { originOk, forbidden } from "../../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 200_000;

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  if (!rel) return Response.json({ error: "missing path" }, { status: 400 });

  const cfg = await loadConfig();

  let note;
  try {
    note = await readNote(cfg.vault.root, rel);
  } catch (e) {
    // readNote throws on traversal attempts ("path is outside vault root").
    return Response.json({ error: String(e) }, { status: 400 });
  }
  if (!note) return Response.json({ error: "not found" }, { status: 404 });

  const truncated = note.body.length > MAX_BODY_CHARS;
  return Response.json({
    path: note.path,
    frontmatter: note.frontmatter,
    body: truncated ? note.body.slice(0, MAX_BODY_CHARS) : note.body,
    truncated,
    bytes: note.body.length,
    mtime: note.mtime,
  });
}
