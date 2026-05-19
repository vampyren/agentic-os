"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Sparkles, RotateCcw } from "lucide-react";
import Markdown from "./Markdown";
import VoiceButton from "./VoiceButton";
import { accentFor } from "@/lib/accent";
import { chatStore } from "@/lib/chatStore";
import { useChatSession } from "@/lib/useChatSession";
import { slugToTitle } from "@/lib/titles";

interface Agent {
  name: string;
  displayName: string;
  description: string | null;
  transport: string;
}

// Local alias — actual type lives in chatStore.ts / types.ts. Used by
// the streaming partial usage capture and ChatBubble's per-message
// footer. SessionUsage isn't aliased separately; its fields are read
// directly from session.sessionUsage which is typed via inference.
type Usage = NonNullable<ReturnType<typeof chatStore.get>["lastUsage"]>;

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
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  // Generation counter that newSession bumps. send() captures the current
  // generation on entry and skips its finally-block commit if the value
  // has changed by then — i.e. the operator clicked New session (or
  // navigated, or fired a fresh send) while this run was still in flight.
  // Without this guard, the aborted run's finally would resurrect an
  // assistant message in the cleared chat (Hermes review of v0.2.7).
  const sendGenRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Slice 4: agent fetch reduced to one-shot — we only need the
  // displayName for the chat header. Vitals are owned by the sidebar's
  // ALL SYSTEMS chip + Mission Control vitals row now, so no per-agent
  // status polling lives in the chat surface anymore.
  useEffect(() => {
    let cancelled = false;
    const fetchAgent = async () => {
      try {
        const list = await fetch("/api/agents", { cache: "no-store" }).then((r) => r.json());
        const a = (list.agents as Agent[]).find((x) => x.name === name);
        if (!cancelled && a) setAgent(a);
      } catch { /* ignore — displayName falls back to the slug */ }
    };
    void fetchAgent();
    return () => { cancelled = true; };
  }, [name]);

  // Autoscroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  // Unmount/agent-change cleanup: abort any in-flight stream and bump the
  // generation so the old send()'s finally block doesn't write to the
  // freshly-mounted AgentRoom's store. Without this, switching agents
  // mid-stream leaves an orphan assistant message in the prior agent's
  // session AND the streaming UI state can race with the new room. (Hermes
  // v0.2.8 review: SECURITY.md was promising this and the code wasn't
  // delivering.)
  useEffect(() => {
    return () => {
      sendGenRef.current++;
      try { ctrlRef.current?.abort(); } catch { /* noop */ }
      ctrlRef.current = null;
    };
  }, [name]);

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
    // Capture the generation at run start. newSession() bumps the counter,
    // so on finally we can detect whether we're still the in-flight run for
    // this room.
    const myGeneration = ++sendGenRef.current;
    let acc = "";
    let savedPath: string | undefined;
    let lastUsage: Usage = {};
    let usageSeen = false;
    let errored = false;

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
      errored = true;
      if (!ctrl.signal.aborted) setError(String(e));
    } finally {
      // Race guard #1 (Hermes review of v0.2.7): don't commit if the
      // operator clicked New session (or started another send) while this
      // run was still in flight. SPA navigation between agents bumps the
      // generation via the unmount cleanup before the finally runs.
      const stillCurrent = myGeneration === sendGenRef.current;
      // Race guard #2 (v0.2.11 regression test): on full page navigation
      // (e.g. Playwright page.goto, or a reload), the browser kills the
      // fetch at the network layer before React can run the unmount
      // cleanup. The finally then sees stillCurrent=true (generation was
      // never bumped) and would commit a "(no output)" orphan that
      // persists to localStorage and re-renders on the next visit. The
      // fix: refuse to commit an empty placeholder for runs that errored.
      // A real agent reply that legitimately produced nothing still gets
      // the "(no output)" marker because !errored.
      const wouldOrphan = errored && acc.length === 0;
      if (stillCurrent && !wouldOrphan) {
        chatStore.appendAssistantMessage(name, {
          role: "assistant",
          text: acc || "(no output)",
          ts: Date.now(),
          savedPath,
          // Only attach usage if the transport actually reported meaningful
          // values. AgentRoom guards as a defense-in-depth on top of the
          // kernel/parser/store guards (v0.2.8).
          usage: usageSeen ? lastUsage : undefined,
        });
      }
      if (stillCurrent) {
        setPartial("");
        setStreaming(false);
        ctrlRef.current = null;
      }
      // If !stillCurrent, the new run (or newSession) already owns the
      // streaming/UI state — leave it alone.
    }
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
  }

  function newSession() {
    // Bump the generation FIRST so any in-flight send()'s finally block
    // detects it's no longer the current run and skips its store commit.
    sendGenRef.current++;
    if (streaming) {
      ctrlRef.current?.abort();
      setStreaming(false);
      ctrlRef.current = null;
    }
    chatStore.newSession(name);
    setPartial("");
    setError(null);
    promptRef.current?.focus();
  }

  // Slice 4: token/cost status strip below the composer. Replaces the
  // old right-rail Tokens panel. Single horizontal line, mono, hidden
  // when there's no usage to report.
  const hasAnyUsage =
    Boolean(usage && (usage.inputTokens || usage.outputTokens)) ||
    sessionUsage.turns > 0;

  return (
    <div className="flex flex-col min-h-[60vh]">
      <section className="panel flex flex-col min-h-0 flex-1">
        {/* Slim chat header — agent avatar + name + small New session.
            The aggregate status signal lives in the sidebar's ALL SYSTEMS
            chip; per-agent vitals are accessible from Mission Control and
            /agents. Chat surface no longer carries them. */}
        <header className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={name} accent={accent} side="assistant" />
            <div className="text-[14px] font-medium" style={{ color: accent }}>
              {/* Synchronous fallback prettifies the slug ("hermes" →
                  "Hermes", "claude-code" → "Claude Code") while the
                  /api/agents fetch is in flight, so the chat header
                  never momentarily renders the raw lowercase slug. Once
                  the manifest resolves, displayName takes over. */}
              {agent?.displayName ?? slugToTitle(name)}
            </div>
          </div>
          <button
            onClick={newSession}
            title="New session — clears this agent's chat history (vault notes are untouched)"
            className="!px-2 !py-1.5 text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg)]"
            disabled={!mounted || (msgs.length === 0 && !streaming)}
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw size={12} />
              New session
            </span>
          </button>
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

        {/* Slim usage/cost strip — replaces the old Tokens panel. Renders
            only when the transport has reported usage at least once this
            session. Single horizontal mono line. */}
        {hasAnyUsage && (
          <div
            data-testid="chat-usage-strip"
            className="border-t border-[var(--border)] px-5 py-2 text-[11px] font-mono text-[var(--fg-dimmer)] flex items-center gap-x-3 gap-y-1 flex-wrap"
          >
            {usage?.model && (
              <span className="text-[var(--fg-dim)]">{usage.model}</span>
            )}
            {usage?.inputTokens !== undefined && usage.inputTokens > 0 && (
              <span>last in <span className="text-[var(--fg-dim)]">{formatK(usage.inputTokens)}</span></span>
            )}
            {usage?.outputTokens !== undefined && usage.outputTokens > 0 && (
              <span>last out <span className="text-[var(--fg-dim)]">{formatK(usage.outputTokens)}</span></span>
            )}
            {sessionUsage.turns > 0 && (
              <>
                <span className="opacity-50">·</span>
                <span>
                  session <span className="text-[var(--fg-dim)]">{sessionUsage.turns} {sessionUsage.turns === 1 ? "turn" : "turns"}</span>
                </span>
                {sessionUsage.inputTokens !== undefined && sessionUsage.inputTokens > 0 && (
                  <span>in <span className="text-[var(--fg-dim)]">{formatK(sessionUsage.inputTokens)}</span></span>
                )}
                {sessionUsage.outputTokens !== undefined && sessionUsage.outputTokens > 0 && (
                  <span>out <span className="text-[var(--fg-dim)]">{formatK(sessionUsage.outputTokens)}</span></span>
                )}
                {sessionUsage.totalCostUsd !== undefined && sessionUsage.totalCostUsd > 0 && (
                  <span className="text-[var(--fg-dim)]">${sessionUsage.totalCostUsd.toFixed(4)}</span>
                )}
              </>
            )}
          </div>
        )}
      </section>
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
