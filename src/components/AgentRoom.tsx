"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square } from "lucide-react";
import Pill, { type PillTone } from "./Pill";
import { accentFor } from "@/lib/accent";

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

interface Msg {
  role: "user" | "assistant";
  text: string;
  ts: number;
  savedPath?: string;
}

export default function AgentRoom({ name }: { name: string }) {
  const accent = accentFor(name);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [prompt, setPrompt] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const userMsg: Msg = { role: "user", text: trimmed, ts: Date.now() };
    setMsgs((m) => [...m, userMsg]);
    setPrompt("");
    setPartial("");
    setError(null);
    setStreaming(true);

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    let acc = "";
    let savedPath: string | undefined;

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
            else if (e.kind === "saved") savedPath = e.path;
            else if (e.kind === "error") setError(e.message);
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(String(e));
    } finally {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: acc || "(no output)", ts: Date.now(), savedPath },
      ]);
      setPartial("");
      setStreaming(false);
      ctrlRef.current = null;
    }
  }

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
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
          {vitals && (
            <Pill tone={vitals.status} pulse={vitals.status === "live"}>
              {vitals.status}
            </Pill>
          )}
        </header>

        <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
          <AnimatePresence initial={false}>
            {msgs.length === 0 && !streaming && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-[var(--fg-dim)] text-[13px] leading-relaxed"
              >
                <p className="text-[var(--fg)] text-[14px] mb-2">Channel open.</p>
                <p>
                  Send a prompt to <code>{name}</code>. Tokens stream in real
                  time, the chat is auto-saved to your Obsidian inbox under
                  <code> 00_Inbox/agentic-os/chats/</code>.
                </p>
              </motion.div>
            )}
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl px-4 py-3 text-[13px] leading-relaxed border"
                style={{
                  background: m.role === "user"
                    ? `color-mix(in srgb, ${accent} 8%, transparent)`
                    : "var(--bg-elevated)",
                  borderColor: m.role === "user"
                    ? `color-mix(in srgb, ${accent} 25%, var(--border))`
                    : "var(--border)",
                }}
              >
                <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60">
                  {m.role === "user" ? "you" : name}
                </div>
                <div className="whitespace-pre-wrap font-mono text-[12.5px]">{m.text}</div>
                {m.savedPath && (
                  <div className="text-[10px] text-[var(--fg-dimmer)] mt-2">
                    saved → <code>{m.savedPath}</code>
                  </div>
                )}
              </motion.div>
            ))}
            {streaming && (
              <motion.div
                key="partial"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="rounded-xl px-4 py-3 text-[13px] leading-relaxed border bg-[var(--bg-elevated)] border-[var(--border)]"
              >
                <div className="text-[10px] tracking-widest uppercase mb-1 opacity-60 flex items-center gap-2">
                  {name}
                  <span className="tick live" style={{ color: accent }} />
                </div>
                <div className="whitespace-pre-wrap font-mono text-[12.5px]">
                  {partial || "thinking…"}
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
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              if (e.key === "Escape" && streaming) stop();
            }}
            rows={2}
            placeholder="Type a prompt…   ⌘+Enter to send · Esc to stop"
            className="flex-1 bg-transparent text-[13px] resize-none px-3 py-2"
            disabled={streaming}
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
