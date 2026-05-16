"use client";

// React hook around chatStore — subscribes to a given agent's session and
// re-renders the component whenever it changes.
//
// SSR/CSR contract:
// - get() returns in-memory state only. On server render and on the client's
//   first render, the session is empty (no localStorage read). HTML matches.
// - hydrate() runs in useEffect after mount, loads any persisted state from
//   localStorage, and triggers a re-render via the subscription. This flash
//   of the empty state is intentional and required for hydration correctness.

import { useEffect, useState } from "react";
import { chatStore, type ChatSession } from "./chatStore";

export function useChatSession(agent: string): ChatSession {
  // Use the rev counter as the dependency so React schedules a re-render
  // when the store mutates.
  const [, force] = useState(0);

  useEffect(() => {
    // Hydrate from localStorage AFTER the first paint, never during render.
    // The subscribe call below makes sure the component re-renders when
    // hydrate() notifies (or any other store mutation fires).
    chatStore.hydrate(agent);
    return chatStore.subscribe(agent, () => force((x) => x + 1));
  }, [agent]);

  return chatStore.get(agent);
}
