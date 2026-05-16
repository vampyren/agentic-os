"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

interface Hit {
  path: string;
  title: string;
  snippet: string;
  type: string | null;
  agent: string | null;
  mtime: number;
  score: number;
}

interface SearchResponse {
  q: string;
  elapsedMs: number;
  indexed: number;
  hits: Hit[];
}

export default function MemoryPage() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setData(null); return; }
    debounce.current = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(`/api/memory/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e) { setError(String(e)); setData(null); }
      finally { setBusy(false); }
    }, 200);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <header>
        <h2 className="text-[20px] font-medium tracking-tight">Memory</h2>
        <p className="text-[12px] text-[var(--fg-dim)] mt-1">
          Full-text search across your Obsidian vault, backed by a local SQLite FTS5 index.
        </p>
      </header>

      <div className="panel p-3 flex items-center gap-3">
        <Search size={16} className="text-[var(--fg-dimmer)] ml-2" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search notes…"
          autoFocus
          className="flex-1 !border-0 !p-2 text-[14px]"
        />
        {data && (
          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mr-2">
            {busy ? "searching…" : `${data.hits.length} / ${data.indexed} · ${data.elapsedMs}ms`}
          </span>
        )}
      </div>

      {error && <div className="text-[12px] text-rose-300">{error}</div>}

      {!data && !busy && (
        <div className="text-[13px] text-[var(--fg-dim)] py-6 text-center">
          Type a query above. Hits show title, snippet, and source.
        </div>
      )}

      {data && data.hits.length === 0 && !busy && (
        <div className="text-[13px] text-[var(--fg-dim)] py-6 text-center">
          No matches for "{data.q}" across {data.indexed} indexed notes.
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {data?.hits.map((h) => (
          <li key={h.path} className="panel px-4 py-3 hover:bg-[var(--bg-elevated-hot)] transition">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <div className="text-[14px] font-medium truncate">{h.title}</div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] shrink-0">
                {h.type ?? "—"}{h.agent ? ` · ${h.agent}` : ""}
              </div>
            </div>
            <div
              className="text-[12.5px] text-[var(--fg-dim)] leading-relaxed mb-1.5"
              dangerouslySetInnerHTML={{ __html: renderSnippet(h.snippet) }}
            />
            <div className="text-[10px] text-[var(--fg-dimmer)] flex justify-between">
              <code>{h.path}</code>
              <span>{new Date(h.mtime).toLocaleDateString()}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// FTS5 snippet uses « and » as delimiters per our query in vaultIndex.ts.
// Convert to highlighted spans.
function renderSnippet(s: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc(s)
    .replace(/«/g, '<mark style="background:rgba(217,119,87,0.25);color:inherit;border-radius:2px;padding:0 2px;">')
    .replace(/»/g, "</mark>");
}
