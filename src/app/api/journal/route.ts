// /api/journal
//  GET                 → today's journal entries (or ?date=YYYY-MM-DD)
//  GET ?recent=N       → last N days' filenames (no body)
//  POST { text }       → append new timestamped entry to today

import { loadConfig } from "@/kernel/config";
import { listInboxNotes, readNote } from "@/vault/reader";
import { appendJournalEntry } from "@/vault/writer";
import { originOk, forbidden } from "../_lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!originOk(req)) return forbidden();
  const cfg = await loadConfig();
  const url = new URL(req.url);
  const recent = url.searchParams.get("recent");

  if (recent) {
    const n = Math.min(60, Math.max(1, Number(recent) || 14));
    const all = await listInboxNotes(cfg.vault.root, "journal");
    const days = all
      .map((p) => p.split("/").pop()?.replace(/\.md$/, ""))
      .filter((d): d is string => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""))
      .slice(0, n);
    return Response.json({ days });
  }

  const date = url.searchParams.get("date") ?? todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response("invalid date", { status: 400 });
  }
  const relPath = `00_Inbox/agentic-os/journal/${date}.md`;
  const note = await readNote(cfg.vault.root, relPath);
  if (!note) return Response.json({ date, exists: false, entries: [] });

  // Parse ### HH:MM sections from body.
  const entries: { time: string; text: string }[] = [];
  const re = /^### (\d{2}:\d{2})\s*\n([\s\S]*?)(?=\n### \d{2}:\d{2}|\n*$)/gm;
  let m;
  while ((m = re.exec(note.body)) !== null) {
    entries.push({ time: m[1] ?? "", text: (m[2] ?? "").trim() });
  }
  return Response.json({ date, exists: true, entries, path: note.path });
}

export async function POST(req: Request) {
  if (!originOk(req)) return forbidden();
  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response("invalid json", { status: 400 }); }

  const { text } = (body ?? {}) as { text?: unknown };
  if (typeof text !== "string" || text.trim().length === 0) {
    return new Response("missing text", { status: 400 });
  }
  if (text.length > 8000) {
    return new Response("entry too long (max 8000 chars)", { status: 413 });
  }

  const cfg = await loadConfig();
  const result = await appendJournalEntry({
    vaultRoot: cfg.vault.root,
    agent: "operator",
    text,
  });
  return Response.json({ ok: true, path: result.path });
}
