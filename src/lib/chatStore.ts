"use client";

// Per-agent chat history that survives in-app navigation.
//
// Why this exists: the previous AgentRoom held all message state in
// component-local React state, so switching between /agents/claude-code
// and /agents/hermes destroyed the conversation on unmount. The operator
// expects the chat to remain until they explicitly start a new session.
//
// Design:
// - A module-level singleton Map<agentName, ChatSession> lives in browser
//   memory across React lifecycles.
// - A small pub/sub lets components re-render when their agent's session
//   changes. Avoids pulling in a state-management library for this one
//   need.
// - localStorage mirrors every write so a full page reload keeps the
//   conversation too. Wiped only by "New session" or "Clear" actions.
// - Vault notes remain the durable, long-term record. This store is only
//   the active in-memory session per agent.

import { hasMeaningfulUsage, type AgentUsage } from "@/kernel/types";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  ts: number;
  savedPath?: string;
  usage?: AgentUsage;
}

export interface SessionUsageTotals extends AgentUsage {
  turns: number;
}

export interface ChatSession {
  msgs: ChatMessage[];
  sessionUsage: SessionUsageTotals;
  lastUsage: AgentUsage | null;
  // Monotonic counter — components subscribe and re-render when this bumps.
  rev: number;
}

const STORAGE_KEY_PREFIX = "agentic-os.chat.";

interface Listener {
  agent: string;
  cb: () => void;
}

class ChatStore {
  private sessions = new Map<string, ChatSession>();
  private listeners: Listener[] = [];
  // Track which agents have already attempted a localStorage load this
  // session so hydrate() is idempotent + safe to call from useEffect.
  private hydrated = new Set<string>();

  /**
   * Return the in-memory session for an agent, creating an empty one if
   * needed. **Does not read from localStorage** — that would break SSR
   * hydration because the server has no `window`, so server-render returns
   * empty while client-render returns persisted data → mismatch.
   *
   * Call `hydrate(agent)` after mount (from a useEffect) to load any
   * persisted state from localStorage.
   */
  get(agent: string): ChatSession {
    let s = this.sessions.get(agent);
    if (!s) {
      s = emptySession();
      this.sessions.set(agent, s);
    }
    return s;
  }

  /**
   * Load any persisted state from localStorage for this agent into the
   * in-memory store. Idempotent — second + subsequent calls for the same
   * agent are no-ops within the same browser-tab lifetime. Triggers a
   * subscribe notification if state was actually loaded so React components
   * subscribed via useChatSession re-render with the restored data.
   *
   * Safe to call from a useEffect — runs only on the client (window check
   * inside loadFromStorage).
   */
  hydrate(agent: string): void {
    if (this.hydrated.has(agent)) return;
    this.hydrated.add(agent);
    const loaded = this.loadFromStorage(agent);
    if (!loaded) return;
    // Replace the in-memory session in-place so the React reference
    // (returned by get()) keeps a stable identity within the same tick.
    const existing = this.sessions.get(agent);
    if (existing) {
      existing.msgs = loaded.msgs;
      existing.sessionUsage = loaded.sessionUsage;
      existing.lastUsage = loaded.lastUsage;
      existing.rev++;
    } else {
      this.sessions.set(agent, loaded);
    }
    this.notify(agent);
  }

  subscribe(agent: string, cb: () => void): () => void {
    const entry: Listener = { agent, cb };
    this.listeners.push(entry);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  appendUserMessage(agent: string, text: string): void {
    const s = this.get(agent);
    s.msgs.push({ role: "user", text, ts: Date.now() });
    s.rev++;
    this.persist(agent, s);
    this.notify(agent);
  }

  appendAssistantMessage(agent: string, msg: ChatMessage): void {
    const s = this.get(agent);
    // Strip empty `{}` usage before persisting so the saved message can't
    // resurrect zero-data turns on reload. (Hermes review of v0.2.6.)
    const cleanMsg = hasMeaningfulUsage(msg.usage)
      ? msg
      : { ...msg, usage: undefined };
    s.msgs.push(cleanMsg);
    s.rev++;
    // Roll cumulative session usage ONLY when the message has real numbers.
    if (hasMeaningfulUsage(msg.usage)) {
      s.sessionUsage = {
        ...s.sessionUsage,
        turns: s.sessionUsage.turns + 1,
        model: msg.usage!.model ?? s.sessionUsage.model,
        inputTokens: (s.sessionUsage.inputTokens ?? 0) + (msg.usage!.inputTokens ?? 0),
        outputTokens: (s.sessionUsage.outputTokens ?? 0) + (msg.usage!.outputTokens ?? 0),
        cacheReadInputTokens: (s.sessionUsage.cacheReadInputTokens ?? 0) + (msg.usage!.cacheReadInputTokens ?? 0),
        cacheCreationInputTokens: (s.sessionUsage.cacheCreationInputTokens ?? 0) + (msg.usage!.cacheCreationInputTokens ?? 0),
        totalCostUsd: (s.sessionUsage.totalCostUsd ?? 0) + (msg.usage!.totalCostUsd ?? 0),
      };
      s.lastUsage = msg.usage!;
    }
    this.persist(agent, s);
    this.notify(agent);
  }

  /**
   * Live-update the most-recent usage during streaming (no message yet).
   * Empty `{}` updates are dropped — they'd otherwise flip the Tokens card
   * into "rendering" mode with zero data, then flicker back. The Tokens
   * card cares about meaningful changes only.
   */
  setLastUsage(agent: string, usage: AgentUsage): void {
    if (!hasMeaningfulUsage(usage)) return;
    const s = this.get(agent);
    s.lastUsage = { ...(s.lastUsage ?? {}), ...usage };
    s.rev++;
    // Don't persist intra-stream usage — only on message commit.
    this.notify(agent);
  }

  /** Start a fresh conversation for one agent. Clears storage too. */
  newSession(agent: string): void {
    this.sessions.set(agent, emptySession());
    // Mark hydrated so a stale localStorage payload can't repopulate the
    // just-cleared session on a subsequent hydrate() call this tab.
    this.hydrated.add(agent);
    this.clearStorage(agent);
    this.notify(agent);
  }

  private persist(agent: string, s: ChatSession): void {
    if (typeof window === "undefined") return;
    try {
      // Persist a slim view — bump rev fresh so cross-tab restores feel
      // distinct.
      window.localStorage.setItem(
        STORAGE_KEY_PREFIX + agent,
        JSON.stringify({ msgs: s.msgs, sessionUsage: s.sessionUsage, lastUsage: s.lastUsage }),
      );
    } catch {
      /* quota / disabled storage — operator still has vault files */
    }
  }

  private clearStorage(agent: string): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.removeItem(STORAGE_KEY_PREFIX + agent); } catch { /* ignore */ }
  }

  private loadFromStorage(agent: string): ChatSession | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + agent);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      // Defensive shape validation. localStorage is operator-controlled and
      // small enough that malformed payloads aren't a security issue, but
      // bad shapes can produce confusing UI state (Hermes review v0.2.7).
      if (!parsed || typeof parsed !== "object") return null;
      const p = parsed as Record<string, unknown>;
      const msgs = Array.isArray(p["msgs"]) ? validateMessages(p["msgs"]) : [];
      const sessionUsage =
        p["sessionUsage"] && typeof p["sessionUsage"] === "object"
          ? validateSessionUsage(p["sessionUsage"] as Record<string, unknown>)
          : { turns: 0 };
      const lastUsage =
        p["lastUsage"] && typeof p["lastUsage"] === "object"
          ? (p["lastUsage"] as AgentUsage)
          : null;
      return { msgs, sessionUsage, lastUsage, rev: 0 };
    } catch {
      return null;
    }
  }

  private notify(agent: string): void {
    for (const l of this.listeners) {
      if (l.agent === agent) l.cb();
    }
  }
}

function emptySession(): ChatSession {
  return { msgs: [], sessionUsage: { turns: 0 }, lastUsage: null, rev: 0 };
}

function validateMessages(raw: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const role = r["role"];
    const text = r["text"];
    const ts = r["ts"];
    if ((role === "user" || role === "assistant") && typeof text === "string" && typeof ts === "number") {
      const msg: ChatMessage = { role, text, ts };
      if (typeof r["savedPath"] === "string") msg.savedPath = r["savedPath"];
      if (r["usage"] && typeof r["usage"] === "object") {
        msg.usage = r["usage"] as AgentUsage;
      }
      out.push(msg);
    }
  }
  return out;
}

function validateSessionUsage(raw: Record<string, unknown>): SessionUsageTotals {
  const out: SessionUsageTotals = { turns: typeof raw["turns"] === "number" ? raw["turns"] : 0 };
  for (const k of [
    "inputTokens", "outputTokens", "cacheReadInputTokens",
    "cacheCreationInputTokens", "totalCostUsd",
  ] as const) {
    if (typeof raw[k] === "number") out[k] = raw[k];
  }
  if (typeof raw["model"] === "string") out.model = raw["model"];
  return out;
}

// Module-level singleton (per browser tab). Survives React hot-reload by
// stashing on globalThis.
const G = globalThis as unknown as { __agenticChatStore?: ChatStore };
export const chatStore: ChatStore =
  G.__agenticChatStore ?? (G.__agenticChatStore = new ChatStore());
