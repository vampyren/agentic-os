"use client";

// Per-agent Control Room. Mounted by the agent page when the operator
// toggles into "Control Room" mode (vs "Chat"). Mirrors Julian's v0.1
// reference layout (source-julian/.../components/AgentRoom.tsx):
//
//   260px left rail                       │   right viewer (1fr)
//   ─────────────                         │   ───────────────────
//   [vitals card]                         │   ┌─ header: agent · action / Label / [refresh]
//   ACTIONS                               │   │
//   ┌──────────────────────────┐          │   │      monospace output
//   │ Status         env       │ ← active │   │      (scrollable, min-h 500px)
//   │ Sessions       history   │          │   │
//   │ Skills         installed │          │   │
//   │ Plugins        marketp.. │          │   │
//   │ Kanban         tasks     │          │   │
//   │ Doctor         check     │          │   │
//   │ Insights       analytics │          │   │
//   └──────────────────────────┘          │   └─ footer: last run · char count
//
// Backend contract (preserved from v0.2.11 AgentActionRail):
// - Calls /api/agents/<name>/actions/<id>. The route is unchanged.
// - Per-action AbortController + generation counter race guard so a slow
//   action can't overwrite a newer click or a now-unmounted room.
// - Fail-soft: errors render as a classified pill + neutral message; the
//   chat path (mounted in the sibling tab) is never affected.
// - No client-side spawn or shell — UI is read-only consumer of the API.

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Cpu, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import Pill, { type PillTone } from "./Pill";
import type { AgentActionConfig } from "@/kernel/types";

interface Agent {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
  actions: AgentActionConfig[];
}

interface Vitals {
  status: PillTone;
  version?: string;
  latencyMs?: number;
  checkedAt?: number;
}

interface ActionResult {
  ok: boolean;
  actionId: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  errorClass?: string;
  errorMessage?: string;
}

interface RunState {
  status: "idle" | "running" | "done";
  result?: ActionResult;
  fetchError?: string;
  runAt?: number;
  generation: number;
}

interface ControlRoomProps {
  name: string;
  agent: Agent | null;
  accent: string;
  vitals: Vitals | null;
  /** Initial selected action id, default = first action in the manifest. */
  defaultActionId?: string;
}

export default function ControlRoom({
  name,
  agent,
  accent,
  vitals,
  defaultActionId,
}: ControlRoomProps) {
  const actions = agent?.actions ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(
    defaultActionId ?? actions[0]?.id ?? null,
  );
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  // Per-action AbortController. Replacing this map's entry cancels the
  // previous in-flight request for that action.
  const ctrls = useRef<Map<string, AbortController>>(new Map());
  // Per-action generation. Bumped on each click; the fetch resolver
  // compares to drop stale responses (e.g. operator clicked again).
  const gens = useRef<Map<string, number>>(new Map());

  // Cleanup on unmount: abort everything in flight. Mirrors AgentRoom's
  // [name] cleanup pattern from v0.2.10.
  useEffect(() => {
    return () => {
      for (const c of ctrls.current.values()) {
        try { c.abort(); } catch { /* noop */ }
      }
      ctrls.current.clear();
    };
  }, []);

  // Seed: when the selection changes (or first mounts), trigger a run
  // unless one already ran or is running for that action.
  useEffect(() => {
    if (!selectedId) return;
    const cur = runs[selectedId];
    if (cur && cur.status !== "idle") return;
    const def = actions.find((a) => a.id === selectedId);
    if (def) void run(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Reset selection if the agent (or its action list) changes.
  useEffect(() => {
    if (!selectedId && actions[0]?.id) setSelectedId(actions[0].id);
    // If the previously-selected id is no longer in the list, fall back
    // to the first available.
    if (selectedId && !actions.some((a) => a.id === selectedId)) {
      setSelectedId(actions[0]?.id ?? null);
    }
  }, [actions, selectedId]);

  async function run(action: AgentActionConfig) {
    ctrls.current.get(action.id)?.abort();
    const ctrl = new AbortController();
    ctrls.current.set(action.id, ctrl);
    const generation = (gens.current.get(action.id) ?? 0) + 1;
    gens.current.set(action.id, generation);

    setRuns((cur) => ({
      ...cur,
      [action.id]: { status: "running", generation },
    }));

    try {
      const r = await fetch(
        `/api/agents/${encodeURIComponent(name)}/actions/${encodeURIComponent(action.id)}`,
        { cache: "no-store", signal: ctrl.signal },
      );
      if (gens.current.get(action.id) !== generation) return;
      const result = await r.json() as ActionResult;
      setRuns((cur) => ({
        ...cur,
        [action.id]: { status: "done", result, generation, runAt: Date.now() },
      }));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (gens.current.get(action.id) !== generation) return;
      setRuns((cur) => ({
        ...cur,
        [action.id]: {
          status: "done",
          fetchError: String(e),
          generation,
          runAt: Date.now(),
        },
      }));
    }
  }

  if (!actions.length) {
    return (
      <div className="panel p-8 text-center">
        <div className="text-[14px] text-[var(--fg)]">No Control Room actions</div>
        <div className="text-[12px] text-[var(--fg-dim)] mt-2 max-w-[420px] mx-auto">
          This agent's manifest declares no <code>actions:</code>. Add a block to
          <code> agents/builtin/{name}.yaml</code> or override at
          <code> ~/.agentic-os/agents/{name}.yaml</code>.
        </div>
      </div>
    );
  }

  const selected = actions.find((a) => a.id === selectedId) ?? actions[0];
  const state = selectedId ? runs[selectedId] : undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5 min-h-[500px]">
      {/* Left rail: vitals card + actions list */}
      <aside className="flex flex-col gap-3">
        <div className="panel p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <div
              className="grid place-items-center w-10 h-10 rounded-xl"
              style={{
                background: `color-mix(in srgb, ${accent} 18%, transparent)`,
                color: accent,
                boxShadow: `0 0 22px -8px ${accent}`,
              }}
            >
              <Cpu size={18} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                State
              </div>
              <div className="text-sm font-medium" style={{ color: accent }}>
                {vitals?.status ?? "unknown"}
              </div>
            </div>
          </div>
          {vitals?.version && (
            <div className="rounded-lg border border-[var(--border)] px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                Version
              </div>
              <div className="text-sm tabular-nums truncate">{vitals.version}</div>
            </div>
          )}
          {agent?.transport && (
            <div className="rounded-lg border border-[var(--border)] px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                Transport
              </div>
              <div className="text-sm truncate">{agent.transport}</div>
            </div>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)] px-1 mt-1">
          Actions
        </div>
        <div className="flex flex-col gap-1">
          {actions.map((a) => {
            const active = a.id === selectedId;
            const rs = runs[a.id];
            return (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                title={`Run \`${a.command.join(" ")}\``}
                className="w-full text-left flex items-center justify-between !px-3 !py-2.5 !rounded-lg transition"
                style={{
                  borderColor: active ? accent : "var(--border)",
                  background: active
                    ? `color-mix(in srgb, ${accent} 12%, transparent)`
                    : "transparent",
                  color: active ? "var(--fg)" : "var(--fg-dim)",
                }}
                aria-current={active ? "true" : undefined}
              >
                <span className="text-[13px] font-medium flex items-center gap-2">
                  {a.label}
                  {rs?.status === "running" && (
                    <Loader2 size={11} className="animate-spin opacity-70" />
                  )}
                  {rs?.status === "done" && rs.result?.ok && (
                    <CheckCircle2 size={11} className="opacity-60" style={{ color: accent }} />
                  )}
                  {rs?.status === "done" && (rs.fetchError || rs.result?.ok === false) && (
                    <AlertTriangle size={11} className="opacity-80 text-rose-300" />
                  )}
                </span>
                {a.hint && (
                  <span className="text-[10px] text-[var(--fg-dimmer)]">{a.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right: viewer panel */}
      <section className="panel flex flex-col min-h-[500px] overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--fg-dimmer)]">
              {name} · {selected?.id}
            </div>
            <div className="text-base font-medium mt-0.5" style={{ color: accent }}>
              {selected?.label ?? "—"}
            </div>
          </div>
          <button
            onClick={() => selected && void run(selected)}
            disabled={state?.status === "running"}
            className="flex items-center gap-1.5 !px-2.5 !py-1.5 !rounded-md text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)] disabled:opacity-40"
            title="Re-run this action"
          >
            <RefreshCw
              size={11}
              className={state?.status === "running" ? "animate-spin" : ""}
            />
            {state?.status === "running" ? "running" : "refresh"}
          </button>
        </header>

        {/* Viewer scroll container. Both axes scroll: vertical for
            long output, horizontal for wide table rows. The inner
            <pre> uses whitespace-pre (not pre-wrap) so columns stay
            aligned and rows don't wrap into garbage. min-w-max on
            the inner block lets it grow past the panel width so
            overflow-x kicks in. */}
        <div className="scroll flex-1 min-h-0 overflow-auto">
          <Viewer state={state} accent={accent} />
        </div>

        <footer className="px-5 py-2 border-t border-[var(--border)] text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] flex justify-between gap-3 min-h-[26px] items-center">
          <span>
            {state?.runAt
              ? `Last run · ${new Date(state.runAt).toLocaleTimeString("en-GB", { hour12: false })}`
              : ""}
            {state?.result?.durationMs !== undefined && (
              <span className="ml-2 tabular-nums">{state.result.durationMs}ms</span>
            )}
          </span>
          <span className="tabular-nums">
            {state?.result?.stdout
              ? `${state.result.stdout.length.toLocaleString()} chars`
              : ""}
            {state?.result?.truncated ? " · truncated" : ""}
          </span>
        </footer>
      </section>
    </div>
  );
}

function Viewer({ state, accent: _accent }: { state: RunState | undefined; accent: string }) {
  if (!state || state.status === "idle") {
    return (
      <div className="p-5 text-[12px] text-[var(--fg-dimmer)]">(no run yet)</div>
    );
  }
  if (state.status === "running") {
    return (
      <div className="p-5 text-[12px] text-[var(--fg-dim)] flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> running…
      </div>
    );
  }
  if (state.fetchError) {
    return (
      <div className="p-5 text-[12px] text-rose-300">
        request failed: {state.fetchError}
      </div>
    );
  }
  const r = state.result!;
  if (!r.ok && r.errorMessage) {
    return (
      <div className="p-5 space-y-3 min-w-max">
        <div className="text-[12px] text-rose-300 flex items-center gap-2 whitespace-normal">
          <AlertTriangle size={12} /> {r.errorClass}: {r.errorMessage}
        </div>
        {r.stderr && (
          <pre
            data-testid="action-output"
            className="text-[11.5px] leading-relaxed whitespace-pre font-mono text-[var(--fg-dim)]"
          >
            {r.stderr}
          </pre>
        )}
      </div>
    );
  }
  // Success — render stdout (and any stderr underneath dimly).
  // `min-w-max` lets the inner block expand to its widest <pre> child,
  // pushing past the panel's content width so the parent's overflow-x
  // surfaces a horizontal scrollbar instead of cutting/wrapping rows.
  return (
    <div className="p-5 space-y-3 min-w-max">
      {r.stdout ? (
        <pre
          data-testid="action-output"
          className="text-[12px] leading-relaxed whitespace-pre font-mono text-[var(--fg)]"
        >
          {r.stdout}
        </pre>
      ) : (
        <div className="text-[12px] text-[var(--fg-dimmer)] italic">(no stdout)</div>
      )}
      {r.stderr && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1">
            stderr
          </div>
          <pre className="text-[11.5px] leading-relaxed whitespace-pre font-mono text-[var(--fg-dim)]">
            {r.stderr}
          </pre>
        </div>
      )}
    </div>
  );
}
