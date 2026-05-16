"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Sparkles, RotateCcw } from "lucide-react";
import Pill, { type PillTone } from "./Pill";
import Markdown from "./Markdown";
import VoiceButton from "./VoiceButton";
import { accentFor } from "@/lib/accent";
import { resolveModel, contextBreakdown } from "@/lib/models";
import { chatStore } from "@/lib/chatStore";
import { useChatSession } from "@/lib/useChatSession";

interface Agent {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
}

interface Vitals {
  status: PillTone;
  version?: string;
  latencyMs?: number;
  checkedAt?: number;
}

// Local aliases — actual types live in chatStore.ts / types.ts.
type Usage = NonNullable<ReturnType<typeof chatStore.get>["lastUsage"]>;
type SessionUsage = ReturnType<typeof chatStore.get>["sessionUsage"];

export default function AgentRoom({ name }: { name: string }) {
  const accent = accentFor(name);
  // Per-agent chat history lives in chatStore so it survives navigation
  // between /agents/<a> and /agents/<b>, and across page reloads. The
  // hook re-renders us when the store mutates.
  const session = useChatSession(name);
  const msgs = session.msgs;
  const usage = session.lastUsage;
  const sessionUsage = session.sessionUsage;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  // Load manifest + vitals.
  useEffect(() => {
    const tick = async () => {
      try {
        const [list, vit] = await Promise.all([
          fetch("/api/agents", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/vitals", { cache: "no-store" }).then((r) => r.json()),
        ]);
        const a = list.agents.find((x: Agent) => x.name === name);
        if (a) setAgent(a);
        const v = vit.agents.find((x: { name: string }) => x.name === name);
        if (v) setVitals({
          status: v.status,
          version: v.version,
          latencyMs: v.latencyMs,
          checkedAt: v.checkedAt,
        });
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [name]);

  // Autoscroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  async function send() {
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;
    chatStore.appendUserMessage(name, trimmed);
    setPrompt("");
    setPartial("");
    setError(null);
    setStreaming(true);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    let acc = "";
    let savedPath: string | undefined;
    let lastUsage: Usage = {};
    let usageSeen = false;

    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(name)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        // eslint-disable-next-line no-cond-assign
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            const e = JSON.parse(line);
            if (e.kind === "token") { acc += e.text; setPartial(acc); }
            else if (e.kind === "usage") {
              lastUsage = { ...lastUsage, ...e.usage };
              usageSeen = true;
              chatStore.setLastUsage(name, lastUsage);
            }
            else if (e.kind === "saved") savedPath = e.path;
            else if (e.kind === "error") setError(e.message);
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(String(e));
    } finally {
      chatStore.appendAssistantMessage(name, {
        role: "assistant",
        text: acc || "(no output)",
        ts: Date.now(),
        savedPath,
        // Only attach usage if the transport actually reported any. Avoids
        // bumping session-turn counters with all-zero data (one of Hermes
        // review's v0.2.6 follow-up items).
        usage: usageSeen ? lastUsage : undefined,
      });
      setPartial("");
      setStreaming(false);
      ctrlRef.current = null;
    }
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
  }

  function newSession() {
    if (streaming) stop();
    chatStore.newSession(name);
    setPartial("");
    setError(null);
    promptRef.current?.focus();
  }

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6 min-h-[70vh]">
      {/* Chat surface */}
      <section className="panel flex flex-col min-h-0">
        <header className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: accent, boxShadow: `0 0 12px -2px ${accent}` }}
            />
            <div className="leading-tight">
              <div className="text-[14px] font-medium">
                {agent?.displayName ?? name}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                {name} · {agent?.transport ?? "…"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {vitals && (
              <Pill tone={vitals.status} pulse={vitals.status === "live"}>
                {vitals.status}
              </Pill>
            )}
            <button
              onClick={newSession}
              title="New session — clears this agent's chat history (vault notes are untouched)"
              className="!px-2 !py-1.5 text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)]"
              disabled={msgs.length === 0 && !streaming}
            >
              <span className="flex items-center gap-1.5">
                <RotateCcw size={12} />
                New session
              </span>
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          <AnimatePresence initial={false}>
            {msgs.length === 0 && !streaming && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-[var(--fg-dim)] text-[13px] leading-relaxed pt-2"
              >
                <p className="text-[var(--fg)] text-[14px] mb-2 flex items-center gap-2">
                  <Sparkles size={14} style={{ color: accent }} />
                  Channel open.
                </p>
                <p>
                  Send a prompt to <code>{name}</code>. Tokens stream in real
                  time. The chat is auto-saved to your Obsidian inbox at
                  <code> 00_Inbox/agentic-os/chats/</code>, and the conversation
                  here persists across navigation — click <em>New session</em>
                  to start fresh.
                </p>
              </motion.div>
            )}
            {msgs.map((m, i) => (
              <ChatBubble
                key={i}
                msg={m}
                agentName={name}
                accent={accent}
              />
            ))}
            {streaming && (
              <motion.div
                key="partial"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 max-w-full"
              >
                <Avatar name={name} accent={accent} side="assistant" />
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="text-[10px] tracking-widest uppercase text-[var(--fg-dimmer)] flex items-center gap-2">
                    {name}
                    <span className="tick live" style={{ color: accent }} />
                  </div>
                  <div
                    className="rounded-2xl rounded-tl-sm px-4 py-3 text-[13px] leading-relaxed border"
                    style={{
                      background: "var(--bg-elevated)",
                      borderColor: "var(--border)",
                    }}
                  >
                    {partial ? (
                      <Markdown>{partial}</Markdown>
                    ) : (
                      <div className="text-[12.5px] text-[var(--fg-dim)] italic">thinking…</div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error && (
          <div className="px-5 py-2 border-t border-[var(--border)] text-[12px] text-rose-300">
            error: {error}
          </div>
        )}

        <div className="border-t border-[var(--border)] p-3 flex gap-2 items-end">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              if (e.key === "Escape" && streaming) stop();
            }}
            rows={2}
            placeholder="Type a prompt…   ⌘+Enter to send · Esc to stop · mic for voice"
            className="flex-1 bg-transparent text-[13px] resize-none px-3 py-2"
            disabled={streaming}
          />
          <VoiceButton
            disabled={streaming}
            onTranscript={(chunk, isFinal) => {
              if (isFinal) {
                setPrompt((cur) => (cur ? cur + " " + chunk : chunk).trim());
              }
            }}
          />
          {streaming ? (
            <button onClick={stop} className="text-rose-300 border-rose-500/40">
              <span className="flex items-center gap-1.5"><Square size={13} />Stop</span>
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!prompt.trim()}
              style={{
                borderColor: `color-mix(in srgb, ${accent} 40%, var(--border))`,
                color: accent,
                background: `color-mix(in srgb, ${accent} 12%, transparent)`,
              }}
            >
              <span className="flex items-center gap-1.5"><Send size={13} />Send</span>
            </button>
          )}
        </div>
      </section>

      {/* Vitals rail */}
      <aside className="flex flex-col gap-4">
        <div className="panel p-5">
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-3">
            Vitals
          </h3>
          {vitals ? (
            <dl className="space-y-2.5 text-[12px]">
              <Row label="status">
                <Pill tone={vitals.status} pulse={vitals.status === "live"}>
                  {vitals.status}
                </Pill>
              </Row>
              <Row label="version">{vitals.version ?? "—"}</Row>
              <Row label="probe latency">
                {vitals.latencyMs !== undefined ? `${vitals.latencyMs}ms` : "—"}
              </Row>
              <Row label="checked">
                {vitals.checkedAt
                  ? new Date(vitals.checkedAt).toLocaleTimeString("en-GB", { hour12: false })
                  : "—"}
              </Row>
            </dl>
          ) : (
            <div className="text-[12px] text-[var(--fg-dimmer)]">probe pending</div>
          )}
        </div>

        {/* Tokens / cost card — only shown when the transport reports usage. */}
        {(usage || sessionUsage.turns > 0) && (
          <div className="panel p-5">
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-3 flex items-baseline justify-between">
              <span>Tokens</span>
              {usage?.model && (
                <span className="text-[10px] normal-case tracking-normal text-[var(--fg-dim)]">
                  {usage.model}
                </span>
              )}
            </h3>

            {usage && (
              usage.inputTokens || usage.outputTokens ||
              usage.cacheReadInputTokens || usage.cacheCreationInputTokens
            ) && (
              <>
                <ContextBar usage={usage} accent={accent} />
                <dl className="space-y-2 text-[12px] mt-3">
                  {usage.inputTokens !== undefined && (
                    <Row label="last in">{formatK(usage.inputTokens)}</Row>
                  )}
                  {usage.outputTokens !== undefined && (
                    <Row label="last out">{formatK(usage.outputTokens)}</Row>
                  )}
                  {usage.cacheReadInputTokens !== undefined && usage.cacheReadInputTokens > 0 && (
                    <Row label="cache hit">{formatK(usage.cacheReadInputTokens)}</Row>
                  )}
                  {usage.totalCostUsd !== undefined && (
                    <Row label="last cost">${usage.totalCostUsd.toFixed(4)}</Row>
                  )}
                </dl>
              </>
            )}

            {sessionUsage.turns > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">
                  Session ({sessionUsage.turns} {sessionUsage.turns === 1 ? "turn" : "turns"})
                </div>
                <dl className="space-y-1.5 text-[12px]">
                  {sessionUsage.inputTokens !== undefined && sessionUsage.inputTokens > 0 && (
                    <Row label="in">{formatK(sessionUsage.inputTokens)}</Row>
                  )}
                  {sessionUsage.outputTokens !== undefined && sessionUsage.outputTokens > 0 && (
                    <Row label="out">{formatK(sessionUsage.outputTokens)}</Row>
                  )}
                  {sessionUsage.totalCostUsd !== undefined && sessionUsage.totalCostUsd > 0 && (
                    <Row label="cost">${sessionUsage.totalCostUsd.toFixed(4)}</Row>
                  )}
                </dl>
              </div>
            )}
          </div>
        )}

        {agent?.description && (
          <div className="panel p-5">
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">
              About
            </h3>
            <p className="text-[12px] text-[var(--fg-dim)] leading-relaxed">
              {agent.description}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--fg-dimmer)] uppercase tracking-widest text-[10px]">
        {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function formatK(n: number): string {
  if (n < 1000) return n.toString();
  return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
}

/**
 * One chat message rendered as a bubble with an avatar circle on the side.
 * User messages right-aligned with accent tint; assistant messages left-
 * aligned with neutral surface. Footer carries saved-path + per-message
 * usage stats.
 */
function ChatBubble({
  msg,
  agentName,
  accent,
}: {
  msg: { role: "user" | "assistant"; text: string; ts: number; savedPath?: string; usage?: Usage };
  agentName: string;
  accent: string;
}) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 max-w-full ${isUser ? "flex-row-reverse" : ""}`}
    >
      <Avatar name={isUser ? "you" : agentName} accent={isUser ? "var(--fg-dim)" : accent} side={isUser ? "user" : "assistant"} />
      <div className={`flex flex-col gap-1 min-w-0 max-w-[88%] ${isUser ? "items-end" : "items-start"}`}>
        <div className="text-[10px] tracking-widest uppercase text-[var(--fg-dimmer)] flex items-center gap-2">
          <span>{isUser ? "you" : agentName}</span>
          <span className="opacity-60">
            {new Date(msg.ts).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div
          className={`px-4 py-3 text-[13px] leading-relaxed border ${
            isUser ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"
          }`}
          style={
            isUser
              ? {
                  background: `color-mix(in srgb, ${accent} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${accent} 28%, var(--border))`,
                }
              : {
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border)",
                }
          }
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{msg.text}</div>
          ) : (
            <Markdown>{msg.text}</Markdown>
          )}
        </div>
        {(msg.savedPath || msg.usage) && (
          <div className="text-[10px] text-[var(--fg-dimmer)] flex items-center gap-2 flex-wrap px-1">
            {msg.savedPath && (
              <span title={msg.savedPath}>saved → <code>{msg.savedPath.split("/").pop()}</code></span>
            )}
            {msg.usage && (msg.usage.inputTokens || msg.usage.outputTokens) && (
              <span className="tabular-nums">
                {msg.usage.inputTokens ? `in ${formatK(msg.usage.inputTokens)}` : ""}
                {msg.usage.inputTokens && msg.usage.outputTokens ? " · " : ""}
                {msg.usage.outputTokens ? `out ${formatK(msg.usage.outputTokens)}` : ""}
                {msg.usage.totalCostUsd ? ` · $${msg.usage.totalCostUsd.toFixed(4)}` : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Small circular avatar derived from the agent name's first letter, tinted
 * with the agent's accent color. Operator-side ("you") uses a neutral dim
 * tone. Keeps the chat surface scannable without per-agent image assets.
 */
function Avatar({
  name,
  accent,
  side,
}: {
  name: string;
  accent: string;
  side: "user" | "assistant";
}) {
  const letter = (name || "?").trim()[0]?.toUpperCase() ?? "?";
  return (
    <div
      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold select-none"
      style={{
        background: side === "assistant"
          ? `color-mix(in srgb, ${accent} 18%, transparent)`
          : "rgba(255,255,255,0.06)",
        color: side === "assistant" ? accent : "var(--fg-dim)",
        border: `1px solid ${side === "assistant"
          ? `color-mix(in srgb, ${accent} 35%, transparent)`
          : "var(--border)"}`,
        boxShadow: side === "assistant"
          ? `0 0 12px -4px ${accent}`
          : undefined,
      }}
      aria-hidden
    >
      {letter}
    </div>
  );
}

/**
 * Context-window fill bar — shows what fraction of the model's max context
 * the last turn consumed. Replaces the old in/out ratio bar, which got
 * visually swamped by cache hits (a 6-in / 86-out call with 18k cache
 * read rendered as "all orange" and told you nothing).
 *
 * The bar visualizes used / max where:
 *   used = input + cacheRead + cacheCreation + output
 *   max  = model's context-window size (e.g. 1M for claude-opus-4-7[1m],
 *          272k for gpt-5.5)
 *
 * Inside the bar, two segments distinguish "context" (the prompt we sent,
 * including cache hits) from "generated" (the model's output) so the
 * operator can see roughly how the budget is split. Hover for the full
 * breakdown.
 */
function ContextBar({
  usage,
  accent,
}: {
  usage: Usage;
  accent: string;
}) {
  const breakdown = contextBreakdown(usage);
  const model = resolveModel(usage.model ?? "");
  const max = model.contextTokens;
  const fillPct = Math.min(100, (breakdown.usedTotal / max) * 100);

  // Within the filled portion, what fraction is generated output (vs.
  // context)? Used to render the small accent-colored tip at the end.
  const filledTokens = Math.max(1, breakdown.usedTotal);
  const outputShareOfFill =
    breakdown.outputTokens > 0
      ? (breakdown.outputTokens / filledTokens) * fillPct
      : 0;
  const contextShareOfFill = fillPct - outputShareOfFill;

  const tip = [
    `${formatK(breakdown.usedTotal)} of ${formatK(max)} (${fillPct.toFixed(1)}%)`,
    breakdown.inputTokens          ? `in: ${formatK(breakdown.inputTokens)}` : "",
    breakdown.cacheReadTokens      ? `cache read: ${formatK(breakdown.cacheReadTokens)}` : "",
    breakdown.cacheCreationTokens  ? `cache create: ${formatK(breakdown.cacheCreationTokens)}` : "",
    breakdown.outputTokens         ? `out: ${formatK(breakdown.outputTokens)}` : "",
  ].filter(Boolean).join(" · ");

  const pctText = fillPct >= 10 ? Math.round(fillPct).toString()
    : fillPct >= 1 ? fillPct.toFixed(1)
    : fillPct.toFixed(2);

  return (
    <div className="flex flex-col gap-2" title={tip}>
      {/* Header line: "USED / MAX" left, percentage right (big). */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[12px] text-[var(--fg-dim)] tabular-nums">
          <span className="text-[var(--fg)] font-medium">{formatK(breakdown.usedTotal)}</span>
          <span className="text-[var(--fg-dimmer)] mx-1">/</span>
          <span>{formatK(max)}</span>
        </div>
        <div className="text-[14px] font-medium tabular-nums" style={{ color: accent }}>
          {pctText}<span className="text-[10px] text-[var(--fg-dimmer)] ml-0.5">%</span>
        </div>
      </div>

      {/* The bar itself — thicker, rounded, two segments with a subtle gap. */}
      <div
        className="w-full h-2.5 rounded-full overflow-hidden flex"
        style={{
          background: "rgba(255,255,255,0.06)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        <div
          style={{
            width: `${contextShareOfFill}%`,
            background: "color-mix(in srgb, var(--fg-dim) 60%, transparent)",
            transition: "width 240ms ease-out",
          }}
        />
        <div
          style={{
            width: `${outputShareOfFill}%`,
            background: accent,
            boxShadow: `0 0 8px -2px ${accent}`,
            transition: "width 240ms ease-out",
          }}
        />
      </div>

      {/* Tiny legend so the two segments are explained without a tooltip. */}
      <div className="flex items-center gap-3 text-[10px] text-[var(--fg-dimmer)] uppercase tracking-widest">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--fg-dim) 60%, transparent)" }} />
          context {formatK(breakdown.contextTotal)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ background: accent }} />
          out {formatK(breakdown.outputTokens)}
        </span>
      </div>
    </div>
  );
}
