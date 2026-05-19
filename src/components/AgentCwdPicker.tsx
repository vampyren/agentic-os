"use client";

// Per-agent working-directory picker. Surfaced on the Mission Control
// portal card for agents that support a configurable cwd (Claude Code
// today). Renders as a single compact inline row:
//
//   [Folder icon button]  ~/Documents · default
//
// Click the icon → popover with the current path + text input + Save +
// Use default (revert to the per-agent default). Path is persisted server-side under
// ~/.agentic-os/agent-cwd.json via PUT /api/agents/<name>/cwd; the
// kernel reads it pre-spawn (see src/kernel/agentCwd.ts).
//
// AgentPortal renders this slot outside the card's navigation Link so
// interactive controls here do not get nested inside an <a>.
//
// Renders nothing until the initial snapshot fetch resolves, so it
// never flashes a placeholder path.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, RotateCcw, Check, AlertTriangle } from "lucide-react";
import { prettyHome } from "@/lib/prettyHome";

interface Snapshot {
  agent: string;
  cwd: string | null;
  persisted: boolean;
  defaultCwd: string | null;
}

interface Props {
  agent: string;
  /** Accent color for the active Save button — matches the agent's
   *  per-agent accent so the picker reads as part of the card. */
  accent: string;
}

export default function AgentCwdPicker({ agent, accent }: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Trigger button — used for anchored positioning of the portalled popover.
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Popover DOM ref, attached after portal mount — used for the
  // outside-click handler and the input autofocus on open.
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Viewport-relative position of the popover anchor (just below the
  // trigger button). Recomputed on each open + on scroll/resize while
  // open so the popover stays glued to the icon.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent)}/cwd`, { cache: "no-store" });
      if (r.ok) {
        const data = (await r.json()) as Snapshot;
        const effective = data.cwd ?? data.defaultCwd ?? "";
        setSnap(data);
        setInput(effective);
      }
    } catch {
      /* leave snap null — caption disappears, popover button hides */
    }
  }, [agent]);

  // One-shot fetch on mount + on agent change.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Compute + maintain anchor position. The popover is rendered via
  // createPortal at document.body, so its `position: fixed` placement
  // is relative to the viewport — getBoundingClientRect on the trigger
  // gives us the right anchor in fixed coordinates.
  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      // Anchor a 320px-wide popover below the icon. Clamp so it never
      // overflows the right edge of the viewport (small cards near the
      // right side of the grid would otherwise clip).
      const popWidth = 320;
      const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, r.left));
      setAnchor({ top: r.bottom + 8, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Autofocus the input when the popover opens so the operator can
  // type/paste immediately. Wait one tick for the portal to mount.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Close popover on outside click. Since the popover is portalled, it
  // is NOT a descendant of this component's root in the DOM — so we
  // check membership of either the trigger or the popover element.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Close on Escape — global handler because the popover lives outside
  // this component's DOM subtree after portal-mount.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const stopAll = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const onSave = useCallback(async (e: React.SyntheticEvent) => {
    stopAll(e);
    setPending(true);
    setError(null);
    setWarning(null);
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent)}/cwd`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: input.trim() }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setError(data?.error ?? `HTTP ${r.status}`);
      } else {
        const snapshot = (data.snapshot as Snapshot | undefined) ?? null;
        const effective = snapshot?.cwd ?? snapshot?.defaultCwd ?? input.trim();
        setSnap(snapshot);
        setInput(effective);
        if (data.warning) setWarning(data.warning);
        else setOpen(false);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setPending(false);
    }
  }, [agent, input]);

  const onReset = useCallback(async (e: React.SyntheticEvent) => {
    stopAll(e);
    setPending(true);
    setError(null);
    setWarning(null);
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent)}/cwd`, {
        method: "DELETE",
      });
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setPending(false);
    }
  }, [agent, refresh]);

  if (!snap) return null;

  const shownCwd = snap.cwd ?? snap.defaultCwd;
  if (!shownCwd) return null;

  const defaultLabel = snap.defaultCwd
    ? prettyHome(snap.defaultCwd)
    : "manifest/process default";

  const buttonStyle = {
    background: open
      ? `color-mix(in srgb, ${accent} 16%, transparent)`
      : "color-mix(in srgb, var(--fg) 6%, transparent)",
    borderColor: open
      ? `color-mix(in srgb, ${accent} 50%, var(--border))`
      : "var(--border)",
    color: open ? accent : "var(--fg-dim)",
  };

  return (
    <>
      <div className="flex items-center gap-2 min-w-0" onClick={stopAll}>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Working directory: ${shownCwd}`}
          title={`Working directory · click to change`}
          onClick={(e) => { stopAll(e); setOpen((v) => !v); setError(null); setWarning(null); }}
          onMouseDown={stopAll}
          className="w-6 h-6 grid place-items-center rounded-md border transition shrink-0"
          style={buttonStyle}
        >
          <Folder size={11} />
        </button>

        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--fg-dimmer)] min-w-0">
          <span className="truncate" title={shownCwd}>
            {prettyHome(shownCwd)}
          </span>
          {!snap.persisted && (
            <span className="opacity-60 shrink-0">· default</span>
          )}
        </div>
      </div>

      {/* Portalled popover. Rendering at document.body escapes the
          AgentPortal's surrounding <Link> entirely — clicks inside the
          popover never bubble to an ancestor <a> and so cannot trigger
          navigation. Position is anchored to the trigger via fixed
          coordinates computed from getBoundingClientRect(). */}
      {open && anchor && typeof document !== "undefined"
        && createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Working directory"
            onClick={(e) => { e.stopPropagation(); }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            style={{
              position: "fixed",
              top: anchor.top,
              left: anchor.left,
              width: 320,
              // Solid opaque background — the previous `--bg-elevated`
              // token is rgba(255,255,255,0.025) which let the card
              // content bleed through. --bg is the page's #08090b.
              // backdrop-blur softens whatever's behind the popover
              // edge for a coherent futuristic feel.
              background: "var(--bg)",
              borderColor: "var(--border)",
              backdropFilter: "blur(12px)",
            }}
            className="rounded-lg border shadow-2xl p-3 z-[100]"
          >
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">
              Working directory
            </div>
            <div className="text-[11px] text-[var(--fg-dim)] mb-2">
              Spawned process cwd for <code>{snap.agent}</code>. Default:{" "}
              <code>{defaultLabel}</code>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(null); setWarning(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave(e);
                // Escape is handled by the global keydown listener.
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="/absolute/path"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full bg-transparent border rounded-md px-2.5 py-1.5 text-[12px] font-mono outline-none focus:border-[color:var(--panel-border-hot)]"
              style={{ borderColor: "var(--border)", color: "var(--fg)" }}
            />
            <div className="mt-1.5 text-[10px] text-[var(--fg-dimmer)]">
              Invalid paths revert to <code>{defaultLabel}</code> at spawn time.
            </div>
            {error && (
              <div className="mt-2 text-[11px] text-rose-300 flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {warning && (
              <div className="mt-2 text-[11px] text-amber-300 flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>{warning}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 mt-2.5">
              <button
                type="button"
                onClick={onReset}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={pending || !snap.persisted}
                title={`Revert to system default (${defaultLabel}). Does NOT affect your chat — only changes the cwd fallback.`}
                className="!px-2 !py-1 text-[11px] flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
                style={{ color: "var(--fg-dim)" }}
              >
                <RotateCcw size={11} />
                Use default
              </button>
              <button
                type="button"
                onClick={onSave}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={pending || input.trim() === shownCwd}
                className="!px-3 !py-1.5 text-[11px] flex items-center gap-1.5 rounded-md disabled:opacity-40"
                style={{
                  borderColor: `color-mix(in srgb, ${accent} 40%, var(--border))`,
                  color: accent,
                  background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                }}
              >
                <Check size={11} />
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
