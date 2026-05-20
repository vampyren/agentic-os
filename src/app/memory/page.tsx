"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Loader2, Brain } from "lucide-react";
import { highlightTerms, parseSnippet, type HighlightSegment } from "@/lib/highlight";
import Markdown from "@/components/Markdown";
import { prettyHome } from "@/lib/prettyHome";

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
  scope: string;
  elapsedMs: number;
  indexed: number;
  hits: Hit[];
}

interface NoteResponse {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  truncated: boolean;
  bytes: number;
  mtime: number;
}

type Scope = "all" | "chats";

interface TabDef {
  id: Scope;
  label: string;
  hint: string;
}

const TABS: TabDef[] = [
  { id: "all",   label: "Obsidian vault",      hint: "Every note across your vault" },
  { id: "chats", label: "Local conversations", hint: "Chat snapshots written by agents to 00_Inbox/agentic-os/chats/" },
];

export default function MemoryPage() {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  // Filter chips: which frontmatter `type`s the operator has toggled off.
  // We derive the chip set from the current hits — start empty (= all on).
  const [filterOut, setFilterOut] = useState<Set<string>>(new Set());
  const [data, setData] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<NoteResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Vault root + indexed count for the empty preview pane (Slice 6).
  // One-shot fetch on mount via the new /api/vault/info GET — small
  // read-only metadata endpoint, no traversal surface.
  const [vaultInfo, setVaultInfo] = useState<{ root: string; indexed: number } | null>(null);
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const searchCtrl = useRef<AbortController | null>(null);
  const previewCtrl = useRef<AbortController | null>(null);

  // Load vault info once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/vault/info", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.root === "string") {
          setVaultInfo({ root: data.root, indexed: data.indexed ?? 0 });
        }
      })
      .catch(() => { /* empty state degrades to no vault path — non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // Reset filter chips when the scope changes — type semantics differ
  // between "everything" and "chats only" and a stale chip set is
  // confusing.
  useEffect(() => { setFilterOut(new Set()); }, [scope]);

  // Search.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setData(null); setSelectedPath(null); setPreview(null); return; }
    debounce.current = setTimeout(async () => {
      searchCtrl.current?.abort();
      const ctrl = new AbortController();
      searchCtrl.current = ctrl;
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/memory/search?q=${encodeURIComponent(q)}&scope=${scope}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(await r.json());
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(String(e));
        setData(null);
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, scope]);

  // Preview load when selection changes.
  useEffect(() => {
    if (!selectedPath) { setPreview(null); return; }
    previewCtrl.current?.abort();
    const ctrl = new AbortController();
    previewCtrl.current = ctrl;
    setPreviewBusy(true);
    setPreviewError(null);
    fetch(`/api/memory/note?path=${encodeURIComponent(selectedPath)}`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setPreview(await r.json() as NoteResponse);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setPreviewError(String(e));
        setPreview(null);
      })
      .finally(() => { if (!ctrl.signal.aborted) setPreviewBusy(false); });
    return () => { ctrl.abort(); };
  }, [selectedPath]);

  // Derive the available type chips from current hits. Sorted by count
  // descending so the most common type leads.
  const typeChips = useMemo(() => {
    if (!data) return [] as Array<{ type: string; count: number }>;
    const counts = new Map<string, number>();
    for (const h of data.hits) {
      const t = h.type ?? "untyped";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  // Apply chip filter on render.
  const visibleHits = useMemo(() => {
    if (!data) return [] as Hit[];
    if (filterOut.size === 0) return data.hits;
    return data.hits.filter((h) => !filterOut.has(h.type ?? "untyped"));
  }, [data, filterOut]);

  function toggleType(type: string) {
    setFilterOut((cur) => {
      const next = new Set(cur);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] text-[var(--fg-dim)]">
        Full-text search across your Obsidian vault, backed by a local SQLite FTS5 index.
      </p>

      {/* Scope tabs — pill chips matching the agent-workspace mode
          toggle visual language (Chat / Control Room pills). Slice 6
          UI polish: previous underline tabs (border-b-2) replaced with
          rounded chips so the page reads as part of the same control
          family as the rest of the app. */}
      <div
        className="flex items-center gap-2"
        role="tablist"
        aria-label="Memory search scope"
      >
        {TABS.map((t) => {
          const active = scope === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              onClick={() => setScope(t.id)}
              title={t.hint}
              className="!px-3 !py-1.5 !rounded-full text-[12.5px] transition"
              style={{
                background: active
                  ? "color-mix(in srgb, var(--accent-hermes) 16%, transparent)"
                  : "transparent",
                borderColor: active
                  ? "color-mix(in srgb, var(--accent-hermes) 50%, var(--border))"
                  : "var(--border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="panel p-3 flex items-center gap-3">
        <Search size={16} className="text-[var(--fg-dimmer)] ml-2" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={scope === "chats" ? "search chat snapshots…" : "search notes…"}
          autoFocus
          className="flex-1 !border-0 !p-2 text-[14px]"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="!p-1 !border-0 text-[var(--fg-dimmer)] hover:text-[var(--fg)]"
            title="Clear"
          >
            <X size={14} />
          </button>
        )}
        {data && (
          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mr-2 tabular-nums">
            {busy
              ? "searching…"
              : `${visibleHits.length} / ${data.indexed} · ${data.elapsedMs}ms`}
          </span>
        )}
      </div>

      {/* Filter chips */}
      {typeChips.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mr-1">
            type
          </span>
          {typeChips.map((c) => {
            const off = filterOut.has(c.type);
            return (
              <button
                key={c.type}
                onClick={() => toggleType(c.type)}
                className="!px-2.5 !py-1 text-[11px] !rounded-full"
                style={{
                  background: off ? "transparent" : "color-mix(in srgb, var(--accent-hermes) 12%, transparent)",
                  color: off ? "var(--fg-dimmer)" : "var(--accent-hermes)",
                  borderColor: off
                    ? "var(--border)"
                    : "color-mix(in srgb, var(--accent-hermes) 30%, var(--border))",
                }}
              >
                {c.type} <span className="opacity-60 tabular-nums">{c.count}</span>
              </button>
            );
          })}
          {filterOut.size > 0 && (
            <button
              onClick={() => setFilterOut(new Set())}
              className="!px-2 !py-1 text-[11px] !border-0 text-[var(--fg-dim)]"
            >
              clear filters
            </button>
          )}
        </div>
      )}

      {error && <div className="text-[12px] text-rose-300">{error}</div>}

      {!data && !busy && (
        <div className="text-[13px] text-[var(--fg-dim)] py-6 text-center">
          {scope === "chats"
            ? "Type a query to search your chat snapshots."
            : "Type a query above. Hits show title, snippet, and source."}
        </div>
      )}

      {data && visibleHits.length === 0 && !busy && (
        <div className="text-[13px] text-[var(--fg-dim)] py-6 text-center">
          No matches for &ldquo;{data.q}&rdquo;
          {filterOut.size > 0 ? " with the current filters." : ` across ${data.indexed} indexed notes.`}
        </div>
      )}

      {/* Two-pane layout when there are hits. Slice 6.1: preview
          column gets more room than the result list so rendered
          markdown (tables, code blocks, headings) has space to
          breathe. Use xl for the split view: at lg widths the fixed
          sidebar leaves too little content width for the two minmax
          floors without horizontal overflow, so the preview stacks
          under the results until the viewport has enough room. */}
      {visibleHits.length > 0 && (
        <div className="grid xl:grid-cols-[minmax(360px,1fr)_minmax(560px,1.4fr)] gap-4">
          <ul className="flex flex-col gap-2 min-w-0">
            {visibleHits.map((h) => {
              const active = h.path === selectedPath;
              return (
                <li key={h.path}>
                  <button
                    onClick={() => setSelectedPath(active ? null : h.path)}
                    className="!p-0 !border-0 !rounded-none w-full text-left"
                  >
                    <div
                      className="px-4 py-3 panel transition cursor-pointer"
                      style={
                        active
                          ? {
                              borderColor: "color-mix(in srgb, var(--accent-hermes) 38%, var(--border))",
                              background: "color-mix(in srgb, var(--accent-hermes) 6%, var(--bg-elevated))",
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <div className="text-[14px] font-medium truncate">
                          {renderHighlightSegments(highlightTerms(h.title, q))}
                        </div>
                        <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] shrink-0">
                          {h.type ?? "—"}{h.agent ? ` · ${h.agent}` : ""}
                        </div>
                      </div>
                      <div className="text-[12.5px] text-[var(--fg-dim)] leading-relaxed mb-1.5">
                        {renderHighlightSegments(parseSnippet(h.snippet))}
                      </div>
                      <div className="text-[10px] text-[var(--fg-dimmer)] flex justify-between gap-3">
                        <code className="truncate">{h.path}</code>
                        <span className="shrink-0">{new Date(h.mtime).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Right-pane preview */}
          <aside className="xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-4rem)]">
            <div className="panel p-5 flex flex-col gap-3 max-h-[calc(100vh-6rem)]">
              {!selectedPath && (
                <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
                  <div
                    className="grid place-items-center w-12 h-12 rounded-2xl"
                    style={{
                      background: "color-mix(in srgb, var(--accent-hermes) 14%, transparent)",
                      color: "var(--accent-hermes)",
                      boxShadow: "0 0 24px -8px var(--accent-hermes)",
                    }}
                    aria-hidden="true"
                  >
                    <Brain size={22} />
                  </div>
                  <div className="text-[13px] text-[var(--fg-dim)]">
                    Select a note or memory to view
                  </div>
                  {vaultInfo && (
                    <div className="flex flex-col items-center gap-0.5 text-[10px] font-mono text-[var(--fg-dimmer)] mt-1">
                      <span className="opacity-70 uppercase tracking-widest text-[9px]">
                        Vault root
                      </span>
                      <code className="break-all max-w-full" title={vaultInfo.root}>
                        {prettyHome(vaultInfo.root)}
                      </code>
                      <span className="opacity-60 tabular-nums mt-0.5">
                        {vaultInfo.indexed.toLocaleString()} notes indexed
                      </span>
                    </div>
                  )}
                </div>
              )}
              {selectedPath && previewBusy && (
                <div className="text-[12px] text-[var(--fg-dim)] flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> loading…
                </div>
              )}
              {selectedPath && previewError && (
                <div className="text-[12px] text-rose-300">{previewError}</div>
              )}
              {selectedPath && preview && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <code className="text-[10px] text-[var(--fg-dimmer)] break-all">
                      {preview.path}
                    </code>
                    <button
                      onClick={() => setSelectedPath(null)}
                      className="!p-1 !border-0 text-[var(--fg-dimmer)] hover:text-[var(--fg)] shrink-0"
                      title="Close preview"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {Object.keys(preview.frontmatter).length > 0 && (
                    <div className="text-[11px] text-[var(--fg-dim)] border border-[var(--border)] rounded-md p-2.5 max-h-[180px] overflow-auto scroll">
                      <div className="text-[9px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">
                        frontmatter
                      </div>
                      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 tabular-nums">
                        {Object.entries(preview.frontmatter).map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-[var(--fg-dimmer)] truncate">{k}</dt>
                            <dd className="truncate">{formatFmValue(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  {/* Slice 6.1: render markdown via the existing
                      <Markdown> component (GFM tables, syntax-
                      highlighted code blocks, headings, lists). The
                      previous whitespace-pre-wrap dump showed raw
                      markdown source which was unreadable for any
                      structured note. */}
                  <div className="overflow-auto scroll max-h-[calc(100vh-22rem)] text-[12.5px] leading-relaxed">
                    {preview.body ? (
                      <Markdown>{preview.body}</Markdown>
                    ) : (
                      <span className="text-[var(--fg-dimmer)] italic">empty</span>
                    )}
                  </div>
                  {preview.truncated && (
                    <div className="text-[10px] text-[var(--fg-dimmer)] italic">
                      preview truncated (200k chars cap)
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// Map highlight segments to React nodes — replaces the previous
// renderSnippet() helper that used dangerouslySetInnerHTML. Each match
// segment becomes a <mark> with our accent-tinted background; plain
// segments render as bare text. The data shape is pure (see
// src/lib/highlight.ts) so the matching logic is unit-tested without
// React rendering.
function renderHighlightSegments(segments: HighlightSegment[]): React.ReactNode {
  return segments.map((seg, i) =>
    seg.mark ? (
      <mark
        key={i}
        className="rounded-[2px] px-[2px]"
        style={{
          background: "color-mix(in srgb, var(--accent-hermes) 25%, transparent)",
          color: "inherit",
        }}
      >
        {seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}

function formatFmValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  try { return JSON.stringify(v); } catch { return "[unprintable]"; }
}
