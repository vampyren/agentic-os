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

import type { AgentUsage } from "@/kernel/types";

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

  /** Return the session for an agent, creating an empty one if needed. */
  get(agent: string): ChatSession {
    let s = this.sessions.get(agent);
    if (!s) {
      s = this.loadFromStorage(agent) ?? emptySession();
      this.sessions.set(agent, s);
    }
    return s;
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
    s.msgs.push(msg);
    s.rev++;
    // Roll cumulative session usage.
    if (msg.usage) {
      s.sessionUsage = {
        ...s.sessionUsage,
        turns: s.sessionUsage.turns + 1,
        model: msg.usage.model ?? s.sessionUsage.model,
        inputTokens: (s.sessionUsage.inputTokens ?? 0) + (msg.usage.inputTokens ?? 0),
        outputTokens: (s.sessionUsage.outputTokens ?? 0) + (msg.usage.outputTokens ?? 0),
        cacheReadInputTokens: (s.sessionUsage.cacheReadInputTokens ?? 0) + (msg.usage.cacheReadInputTokens ?? 0),
        cacheCreationInputTokens: (s.sessionUsage.cacheCreationInputTokens ?? 0) + (msg.usage.cacheCreationInputTokens ?? 0),
        totalCostUsd: (s.sessionUsage.totalCostUsd ?? 0) + (msg.usage.totalCostUsd ?? 0),
      };
      s.lastUsage = msg.usage;
    }
    this.persist(agent, s);
    this.notify(agent);
  }

  /** Live-update the most-recent usage during streaming (no message yet). */
  setLastUsage(agent: string, usage: AgentUsage): void {
    const s = this.get(agent);
    s.lastUsage = { ...(s.lastUsage ?? {}), ...usage };
    s.rev++;
    // Don't persist intra-stream usage — only on message commit.
    this.notify(agent);
  }

  /** Start a fresh conversation for one agent. Clears storage too. */
  newSession(agent: string): void {
    this.sessions.set(agent, emptySession());
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
      const parsed = JSON.parse(raw) as {
        msgs?: ChatMessage[];
        sessionUsage?: SessionUsageTotals;
        lastUsage?: AgentUsage | null;
      };
      return {
        msgs: parsed.msgs ?? [],
        sessionUsage: parsed.sessionUsage ?? { turns: 0 },
        lastUsage: parsed.lastUsage ?? null,
        rev: 0,
      };
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

// Module-level singleton (per browser tab). Survives React hot-reload by
// stashing on globalThis.
const G = globalThis as unknown as { __agenticChatStore?: ChatStore };
export const chatStore: ChatStore =
  G.__agenticChatStore ?? (G.__agenticChatStore = new ChatStore());
