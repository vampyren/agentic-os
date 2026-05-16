// /api/goals — list (GET) and create (POST). Each goal is one file under
// <vault>/00_Inbox/agentic-os/goals/. Toggle done via PATCH /api/goals/toggle.

import { loadConfig } from "@/kernel/config";
import { readInboxNotes } from "@/vault/reader";
import { writeDraft } from "@/vault/writer";
import { originOk, forbidden } from "../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Goal {
  path: string;
  title: string;
  category: string | null;
  goalStatus: "open" | "done";
  body: string;
  mtime: number;
}

function parseGoal(note: { path: string; frontmatter: Record<string, unknown>; body: string; mtime: number }): Goal {
  // Title = first H1 line, falling back to filename stem.
  const m = note.body.match(/^#\s+(.+)$/m);
  const title = m?.[1]?.trim() ?? note.path.split("/").pop()?.replace(/\.md$/, "") ?? "untitled";
  const body = note.body.replace(/^#\s+.+\n?/m, "").trim();
  return {
    path: note.path,
    title,
    category: (note.frontmatter["category"] as string | undefined) ?? null,
    goalStatus: (note.frontmatter["goalStatus"] as "open" | "done") ?? "open",
    body,
    mtime: note.mtime,
  };
}

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  const cfg = await loadConfig();
  const notes = await readInboxNotes(cfg.vault.root, "goals");
  const goals: Goal[] = notes
    .filter((n) => (n.frontmatter["type"] as string | undefined) === "goal")
    .map(parseGoal);
  return Response.json({ goals });
}

export async function POST(req: Request) {
  if (!originOk(req)) return forbidden();
  if (!originOk(req)) return forbidden();

  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response("invalid json", { status: 400 }); }

  const { title, category } = (body ?? {}) as { title?: unknown; category?: unknown };
  if (typeof title !== "string" || title.trim().length === 0) {
    return new Response("missing title", { status: 400 });
  }
  if (title.length > 240) {
    return new Response("title too long (max 240 chars)", { status: 413 });
  }

  const cfg = await loadConfig();
  const result = await writeDraft({
    vaultRoot: cfg.vault.root,
    agent: "operator",
    kind: "goal",
    title: title.trim(),
    body: "",
  });

  // Patch in the OS-specific goal fields after creation. (writeDraft only
  // sets the standard contract frontmatter; goalStatus + category are
  // OS-specific.)
  const { updateFrontmatter } = await import("@/vault/writer");
  await updateFrontmatter({
    vaultRoot: cfg.vault.root,
    relPath: result.path,
    agent: "operator",
    patch: {
      goalStatus: "open",
      ...(typeof category === "string" && category.trim().length > 0 ? { category: category.trim() } : {}),
    },
  });

  return Response.json({ ok: true, path: result.path });
}
